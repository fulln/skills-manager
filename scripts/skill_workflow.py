#!/usr/bin/env python3
"""Project skill discovery and invocation statistics without task tracking."""
from __future__ import annotations
import argparse, hashlib, json, os, re, sqlite3, subprocess, time, uuid, fcntl
from contextlib import contextmanager
from pathlib import Path

DEFAULT_ROOT = Path(os.environ.get("SKILLS_MANAGER_DEV_ROOT", Path.home()/"Library/Application Support/skills-manager-dev"))
MAX_OUT = 4000
INVOCATION_TTL = 24 * 60 * 60

def now(): return int(time.time())
def validate_root(root):
    root=Path(root).resolve()
    production=(Path.home()/'.skills-manager').resolve()
    if root==production or production in root.parents: raise ValueError('development root cannot be the production library')
    for name in ('library','workflow.sqlite3','sync.json'):
        p=root/name
        if p.is_symlink(): raise ValueError('development runtime cannot contain redirected paths')
    return root

@contextmanager
def refresh_lock(root):
    validate_root(root); root.mkdir(parents=True,exist_ok=True)
    with (root/'refresh.lock').open('a') as f:
        fcntl.flock(f,fcntl.LOCK_EX)
        yield

def db(root):
    validate_root(root)
    root.mkdir(parents=True, exist_ok=True); c=sqlite3.connect(root/"workflow.sqlite3",timeout=20); c.execute("PRAGMA journal_mode=WAL")
    c.executescript("""CREATE TABLE IF NOT EXISTS project_inputs(path TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT,path TEXT UNIQUE,domain TEXT,skills_json TEXT);
    CREATE TABLE IF NOT EXISTS skills(id TEXT PRIMARY KEY,name TEXT,path TEXT,description TEXT,scope TEXT,project_id TEXT,role TEXT,tags TEXT);
    CREATE TABLE IF NOT EXISTS skill_provenance(skill_id TEXT PRIMARY KEY,metadata TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS skill_categories(canonical_path TEXT PRIMARY KEY,category TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS pending_invocations(id TEXT PRIMARY KEY,project_path TEXT,agent TEXT,created_at INTEGER,selected_skills TEXT);"""); return c
def safe_id(s): return hashlib.sha256(str(s).encode()).hexdigest()[:20]
def discover(home):
    import workflow_discovery
    return workflow_discovery.discover(home)

def project_scope(root, project):
    with sqlite3.connect(root/'library'/'skills-governance.sqlite3') as g:
        row=g.execute('SELECT id FROM scopes WHERE project_path=?',(str(Path(project).resolve()),)).fetchone()
        return row[0] if row else None

def effective(root, project):
    """Nearest binding wins, then a local skill of the same name overrides global."""
    sid=project_scope(root,project); result={}; seen=set()
    with sqlite3.connect(root/'library'/'skills-governance.sqlite3') as g:
        while sid and sid not in seen:
            seen.add(sid)
            for skill,role,excluded in g.execute('SELECT skill_id,role,excluded FROM scope_skills WHERE scope_id=?',(sid,)):
                result.setdefault(skill, (role,bool(excluded)))
            row=g.execute('SELECT parent_id FROM scopes WHERE id=?',(sid,)).fetchone(); sid=row[0] if row else None
    return result
def sync(root,data):
    c=db(root); c.execute("DELETE FROM projects"); c.execute("DELETE FROM skills")
    for p in data.get("projects",[]): c.execute("INSERT OR REPLACE INTO projects VALUES(?,?,?,?,?)",(p.get("id") or safe_id(p.get("path")),p.get("name") or Path(p["path"]).name,str(Path(p["path"]).resolve()),p.get("domain"),json.dumps(p.get("skills",[]))))
    for s in data.get("skills",[]): c.execute("INSERT OR REPLACE INTO skills VALUES(?,?,?,?,?,?,?,?)",(s.get("id") or safe_id(s["path"]),s.get("name") or Path(s["path"]).name,s["path"],s.get("description", ""),s.get("scope","global"),s.get("project_id"),s.get("role", __import__("workflow_discovery")._role(s)),json.dumps(s.get("tags",[]))))
    for p in data.get("projects",[]):
        pid=p.get("id") or safe_id(p["path"])
        for s in p.get("skills",[]): c.execute("INSERT OR REPLACE INTO skills VALUES(?,?,?,?,?,?,?,?)",(s.get("id") or safe_id(s["path"]),s.get("name") or Path(s["path"]).name,s["path"],s.get("description", ""),"project",pid,s.get("role", __import__("workflow_discovery")._role(s)),json.dumps(s.get("tags",[]))))
    from skill_provenance import classify
    metadata_by_path={}
    for record in data.get("skills",[]):
        metadata=record.get('_provenance') or classify(record)
        metadata_by_path[metadata['canonical_path']]=metadata
        c.execute('INSERT OR REPLACE INTO skill_provenance VALUES(?,?)',(record['id'],json.dumps(metadata,ensure_ascii=False)))
    for project in data.get('projects',[]):
        for record in project.get('skills',[]):
            canonical=str(Path(record['path']).resolve())
            metadata=metadata_by_path.get(canonical) or classify(record)
            c.execute('INSERT OR REPLACE INTO skill_provenance VALUES(?,?)',(record['id'],json.dumps(metadata,ensure_ascii=False)))
    c.commit(); return c

def set_category(root,skill_id,category):
    if category not in ('auto','local_packaged','downloaded','downloaded_modified'):
        raise ValueError('unknown skill category')
    c=db(root)
    row=c.execute('SELECT s.path,p.metadata FROM skills s LEFT JOIN skill_provenance p ON p.skill_id=s.id WHERE s.id=?',(skill_id,)).fetchone()
    if not row: raise ValueError('skill not found in current catalog')
    canonical=json.loads(row[1]).get('canonical_path') if row[1] else str(Path(row[0]).resolve())
    if category=='auto': c.execute('DELETE FROM skill_categories WHERE canonical_path=?',(canonical,))
    else: c.execute('INSERT OR REPLACE INTO skill_categories VALUES(?,?)',(canonical,category))
    c.commit(); c.close(); return snapshot(root)

def refresh_unlocked(root,home):
    validate_root(root)
    data=discover(home)
    import workflow_discovery
    known={p['path'] for p in data['projects']}
    with db(root) as c:
        for (path,) in c.execute('SELECT path FROM project_inputs'):
            q=Path(path)
            if path not in known and q.is_dir() and any((q/m).exists() for m in workflow_discovery.MARKERS):
                data['projects'].append({'path':path,'name':q.name,'domain':workflow_discovery._domain(q,home),'source':'current-task','skills':workflow_discovery._local_skills(q)})
    error=data.get("warnings",[])
    if error and not data.get('skills'):
        with db(root) as cached:
            cached.row_factory=sqlite3.Row
            for item in cached.execute('SELECT * FROM skills WHERE project_id IS NULL'):
                record=dict(item);record['tags']=json.loads(record['tags'] or '[]');provenance=cached.execute('SELECT metadata FROM skill_provenance WHERE skill_id=?',(record['id'],)).fetchone();record['_provenance']=json.loads(provenance[0]) if provenance else None;data['skills'].append(record)
    try:
        import workflow_discovery
        workflow_discovery.sync_governance(root,data)
    except Exception as e: raise RuntimeError("governance sync: " + str(e))
    c=sync(root,data)
    temporary=root/("sync-"+str(uuid.uuid4())+".tmp")
    temporary.write_text(json.dumps({"last_refresh":now(),"running":False,"error":"; ".join(error) or None,"project_count":len(data.get("projects",[])),"skill_count":len(data.get("skills",[]))+sum(len(p.get("skills",[])) for p in data.get("projects",[]))}))
    temporary.replace(root/"sync.json")
    return snapshot(root)

def refresh(root,home):
    with refresh_lock(root): return refresh_unlocked(root,home)

def snapshot(root):
    c=db(root); rows=lambda q:[dict(zip([x[0] for x in c.execute(q).description],r)) for r in c.execute(q)]
    ps=rows("SELECT id,name,path,domain FROM projects"); ss=rows("SELECT id,name,description,path,scope,project_id,role,tags FROM skills")
    from skill_provenance import classify
    categories=dict(c.execute('SELECT canonical_path,category FROM skill_categories'))
    provenance={sid:json.loads(metadata) for sid,metadata in c.execute('SELECT skill_id,metadata FROM skill_provenance')}
    for skill in ss:
        metadata=provenance.get(skill['id']) or classify(skill)
        skill.update(metadata)
        skill['tags']=json.loads(skill['tags'] or '[]')
        skill['detected_category']=metadata['category']
        skill['category_override']=categories.get(metadata['canonical_path'])
        skill['category']=skill['category_override'] or skill['detected_category']
    syncv=json.loads((root/"sync.json").read_text()) if (root/"sync.json").exists() else {"running":False,"error":None,"project_count":len(ps),"skill_count":len(ss)}
    for p in ps: p["effective_skill_ids"]=[sid for sid,binding in effective(root,p['path']).items() if not binding[1]]; p["skill_count"]=len([x for x in ss if x['id'] in p['effective_skill_ids'] and (not x["project_id"] or x["project_id"]==p["id"])])
    return {"projects":ps,"skills":ss,"sync":syncv,"bridge_path":str(Path(__file__).resolve())}
def score(skill,task):
    text=(skill['name']+' '+skill.get('description','')+' '+(skill.get('tags') or '')).lower()
    words=set(re.findall(r'[a-z0-9_-]{2,}',task.lower()))
    for phrase in re.findall(r'[\u4e00-\u9fff]+',task):
        words.update(phrase[i:i+2] for i in range(len(phrase)-1))
    aliases={'架构':'architecture', '分析':'analy', '视频':'video', '检查':'check', '研究':'research', '测试':'test'}
    words.update(v for k,v in aliases.items() if k in task)
    return sum(len(w) for w in words if w in text)
def recommend(root,project,task,agent,home=None):
    # Refresh the live catalog before choosing; failed refresh preserves existing cache.
    refresh(root, Path(home or Path.home()))
    c=db(root); p=c.execute("SELECT * FROM projects WHERE path=?",(str(Path(project).resolve()),)).fetchone()
    if not p:
        current=Path(project).resolve()
        parents=[q for q in (current,*current.parents) if q.is_dir() and any((q/m).exists() for m in __import__('workflow_discovery').MARKERS)]
        if not parents: raise SystemExit("current directory has no project markers")
        actual=parents[0]
        p=c.execute("SELECT * FROM projects WHERE path=?",(str(actual),)).fetchone()
        if not p:
            import workflow_discovery
            data=discover(Path(home or Path.home()))
            data['projects'].append({'path':str(actual),'name':actual.name,'domain':workflow_discovery._domain(actual,Path(home or Path.home())),'source':'current-task','skills':workflow_discovery._local_skills(actual)})
            with refresh_lock(root):
                workflow_discovery.sync_governance(root,data); c=sync(root,data)
                c.execute('INSERT OR IGNORE INTO project_inputs VALUES(?)',(str(actual),));c.commit()
            p=c.execute('SELECT * FROM projects WHERE path=?',(str(actual),)).fetchone()
        project=p[2]
    cols=[x[0] for x in c.execute("SELECT * FROM skills LIMIT 0").description]; allr=[dict(zip(cols,r)) for r in c.execute("SELECT * FROM skills")]
    selected=[]; bindings=effective(root,project)
    local_names={s["name"] for s in allr if s["project_id"]==p[0]}
    for s in allr:
        binding=bindings.get(s["id"])
        if not binding or binding[1]: continue
        if not s["project_id"] and s["name"] in local_names: continue
        if not (Path(s["path"])/"SKILL.md").is_file(): continue
        if s['project_id'] and s['project_id'] != p[0]: continue
        tags=json.loads(s.get('tags') or '[]')
        if '历史保留' in tags and not any(word in task for word in ('历史','旧版')): continue
        n=score(s,task)
        if n: selected.append({"id":s['id'],"name":s['name'],"path":s['path'],"score":n,"reason":f"任务词匹配 {n} 分；"+("项目专用" if s["project_id"] else "继承技能"),"instructions":f"Read {Path(s['path'])/'SKILL.md'} before execution"})
    selected.sort(key=lambda x:(-x['score'],x['name'])); selected=selected[:5]
    rid=str(uuid.uuid4())
    # Only short-lived invocation metadata survives this process. Never persist
    # the matching description or an execution command/result as a task record.
    c.execute("DELETE FROM pending_invocations WHERE created_at<?",(now()-INVOCATION_TTL,))
    if selected:
        c.execute("INSERT INTO pending_invocations VALUES(?,?,?,?,?)",(rid,p[2],agent,now(),json.dumps(selected)))
    c.commit(); c.close()
    return {"run_id":rid,"project_id":p[0],"candidates":selected,"instructions":"先读取候选的 SKILL.md，再依照技能完成授权操作。实际命令通过此桥接 run --run-id " + rid + " --skill <候选ID> --artifact <产物路径> -- <命令参数> 执行；仅累计技能使用，不保存任务描述、命令或结果。推荐本身不计作使用。"}
def run_cmd(root,rid,skill,argv,artifacts):
    c=db(root)
    r=c.execute("SELECT project_path,agent,selected_skills FROM pending_invocations WHERE id=? AND created_at>=?",(rid,now()-INVOCATION_TTL)).fetchone()
    if not r: raise SystemExit("invocation missing, expired or already consumed")
    project,agent,selected_json=r
    selected=json.loads(selected_json or '[]'); cand=next((x for x in selected if x['id']==skill or x['name']==skill),None)
    binding=effective(root,project).get(cand['id']) if cand else None
    if not cand or not binding or binding[1] or not (Path(cand['path'])/"SKILL.md").is_file(): raise SystemExit("skill is not a candidate or SKILL.md missing")
    if not argv: raise SystemExit("command required")
    paths=[Path(a) if Path(a).is_absolute() else Path(project)/a for a in artifacts]
    before={str(q):q.stat().st_mtime_ns if q.is_file() else None for q in paths}
    # Atomic, single-use claim: competing callers cannot execute the same ID.
    claimed=c.execute("DELETE FROM pending_invocations WHERE id=? AND created_at>=?",(rid,now()-INVOCATION_TTL)).rowcount
    c.commit(); c.close()
    if claimed != 1: raise SystemExit("invocation already consumed")
    proc=subprocess.run(argv,cwd=project,shell=False,text=True,capture_output=True,timeout=3600)
    updated=all(q.is_file() and q.stat().st_mtime_ns!=before[str(q)] for q in paths)
    status='succeeded' if proc.returncode==0 and updated else 'failed'
    # Actual execution is the only source of explicit usage evidence. No task,
    # command, artifact or outcome details are written to the usage ledger.
    u=root/"library"/"usage-events.sqlite3"; u.parent.mkdir(parents=True,exist_ok=True); uc=sqlite3.connect(u,timeout=20); uc.executescript("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS usage_events(id TEXT PRIMARY KEY,skill TEXT NOT NULL,project TEXT,agent TEXT,occurred_at INTEGER NOT NULL,session_id TEXT NOT NULL,evidence TEXT NOT NULL,source TEXT NOT NULL,source_ref TEXT,excerpt TEXT); CREATE UNIQUE INDEX IF NOT EXISTS usage_identity ON usage_events(source,session_id,skill); CREATE INDEX IF NOT EXISTS usage_time ON usage_events(occurred_at);")
    uid=hashlib.sha256(("workflow|"+rid+"|"+skill).encode()).hexdigest(); uc.execute("INSERT OR IGNORE INTO usage_events VALUES(?,?,?,?,?,?,?,?,?,?)",(uid,cand['name'],project_scope(root,project),agent,now(),rid,'explicit_invocation','workflow',rid,'skill invocation')); uc.commit(); uc.close()
    print(json.dumps({"run_id":rid,"status":status,"exit_code":proc.returncode,"stdout":proc.stdout[-MAX_OUT:],"stderr":proc.stderr[-MAX_OUT:]})); return proc.returncode or (0 if status=="succeeded" else 1)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--root',type=Path,default=DEFAULT_ROOT); ap.add_argument('--home',type=Path,default=Path.home())
    sp=ap.add_subparsers(dest='cmd',required=True); sp.add_parser('refresh'); sp.add_parser('snapshot')
    category=sp.add_parser('set-category'); category.add_argument('--skill-id',required=True); category.add_argument('--category',required=True,choices=['auto','local_packaged','downloaded','downloaded_modified'])
    q=sp.add_parser('recommend'); q.add_argument('--project',required=True); q.add_argument('--task',required=True); q.add_argument('--agent',default='codex')
    r=sp.add_parser('run'); r.add_argument('--run-id',required=True); r.add_argument('--skill',required=True); r.add_argument('--artifact',action='append',default=[]); r.add_argument('command',nargs=argparse.REMAINDER)
    a=ap.parse_args(); root=validate_root(a.root)
    if a.cmd=='refresh': print(json.dumps(refresh(root,a.home),ensure_ascii=False)); return
    if a.cmd=='snapshot': print(json.dumps(snapshot(root),ensure_ascii=False)); return
    if a.cmd=='set-category': print(json.dumps(set_category(root,a.skill_id,a.category),ensure_ascii=False)); return
    if a.cmd=='recommend': print(json.dumps(recommend(root,a.project,a.task,a.agent,a.home),ensure_ascii=False)); return
    if a.cmd=='run':
        argv=a.command[1:] if a.command and a.command[0]=='--' else a.command
        raise SystemExit(run_cmd(root,a.run_id,a.skill,argv,a.artifact))
if __name__=='__main__': main()
