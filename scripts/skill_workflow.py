#!/usr/bin/env python3
"""Small, isolated workflow bridge for the Skills Manager development copy."""
from __future__ import annotations
import argparse, hashlib, json, os, re, sqlite3, subprocess, time, uuid, fcntl
from contextlib import contextmanager
from pathlib import Path

DEFAULT_ROOT = Path(os.environ.get("SKILLS_MANAGER_DEV_ROOT", Path.home()/"Library/Application Support/skills-manager-dev"))
MAX_OUT = 4000

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
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT,project_path TEXT,task TEXT,agent TEXT,status TEXT,created_at INTEGER,finished_at INTEGER,selected_skills TEXT,command TEXT,exit_code INTEGER,artifacts TEXT,error TEXT);"""); return c
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
    c.commit(); return c
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
                record=dict(item);record['tags']=json.loads(record['tags'] or '[]');data['skills'].append(record)
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
    ps=rows("SELECT id,name,path,domain FROM projects"); ss=rows("SELECT id,name,description,path,scope,project_id,role FROM skills"); runs=[]
    for r in c.execute("SELECT * FROM runs ORDER BY created_at DESC"):
        d=dict(zip([x[0] for x in c.execute('SELECT * FROM runs LIMIT 0').description],r))
        for k in ('selected_skills','artifacts'): d[k]=json.loads(d[k] or '[]')
        d['artifact_evidence']=d['artifacts']; d['artifacts']=[x['path'] if isinstance(x,dict) else x for x in d['artifacts']]
        runs.append(d)
    syncv=json.loads((root/"sync.json").read_text()) if (root/"sync.json").exists() else {"running":False,"error":None,"project_count":len(ps),"skill_count":len(ss)}
    for p in ps: p["effective_skill_ids"]=[sid for sid,binding in effective(root,p['path']).items() if not binding[1]]; p["skill_count"]=len([x for x in ss if x['id'] in p['effective_skill_ids'] and (not x["project_id"] or x["project_id"]==p["id"])])
    return {"projects":ps,"skills":ss,"runs":runs,"sync":syncv,"bridge_path":str(Path(__file__).resolve())}
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
    rid=str(uuid.uuid4()); c.execute("INSERT INTO runs(id,project_id,project_path,task,agent,status,created_at,selected_skills) VALUES(?,?,?,?,?,?,?,?)",(rid,p[0],p[2],task,agent,'selected',now(),json.dumps(selected))); c.commit(); return {"run_id":rid,"project_id":p[0],"candidates":selected,"instructions":"先读取候选的 SKILL.md，再依照技能完成授权任务。实际命令通过此桥接 run --run-id " + rid + " --skill <候选ID> --artifact <产物路径> -- <命令参数> 执行并记录；推荐本身不计作使用。"}
def run_cmd(root,rid,skill,argv,artifacts):
    c=db(root); r=c.execute("SELECT * FROM runs WHERE id=?",(rid,)).fetchone()
    if not r or r[5] != 'selected': raise SystemExit("run missing or already finished")
    selected=json.loads(r[8] or '[]'); cand=next((x for x in selected if x['id']==skill or x['name']==skill),None)
    binding=effective(root,r[2]).get(cand['id']) if cand else None
    if not cand or not binding or binding[1] or not (Path(cand['path'])/"SKILL.md").is_file(): raise SystemExit("skill is not a candidate or SKILL.md missing")
    if not argv: raise SystemExit("command required")
    safe=[]; redact_next=False
    for a in argv:
        sensitive=bool(re.search(r"(token|secret|password|api[_-]?key|authorization)",a,re.I))
        safe.append("<redacted>" if redact_next or sensitive else a)
        redact_next=sensitive and '=' not in a
    paths=[Path(a) if Path(a).is_absolute() else Path(r[2])/a for a in artifacts]
    before={str(q):q.stat().st_mtime_ns if q.is_file() else None for q in paths}
    c.execute("UPDATE runs SET status='running',command=?,selected_skills=? WHERE id=? AND status='selected'",(json.dumps(safe),json.dumps([cand]),rid));
    if c.total_changes != 1: raise SystemExit("run already claimed")
    c.commit()
    try: proc=subprocess.run(argv,cwd=r[2],shell=False,text=True,capture_output=True,timeout=3600)
    except Exception as e: c.execute("UPDATE runs SET status='failed',finished_at=?,error=? WHERE id=?",(now(),type(e).__name__,rid)); c.commit(); raise
    ev=[]
    for q in paths:
        ev.append({"path":str(q),"exists":q.is_file(),"updated":q.is_file() and q.stat().st_mtime_ns!=before[str(q)],"sha256":hashlib.sha256(q.read_bytes()).hexdigest() if q.is_file() else None})
    status='succeeded' if proc.returncode==0 and all(x['exists'] and x['updated'] for x in ev) else ('succeeded' if proc.returncode==0 and not ev else 'failed')
    c.execute("UPDATE runs SET status=?,finished_at=?,exit_code=?,artifacts=?,error=? WHERE id=?",(status,now(),proc.returncode,json.dumps(ev),'command failed' if proc.returncode else None,rid)); c.commit()
    # Actual execution is the only source of explicit usage evidence.
    u=root/"library"/"usage-events.sqlite3"; u.parent.mkdir(parents=True,exist_ok=True); uc=sqlite3.connect(u); uc.executescript("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS usage_events(id TEXT PRIMARY KEY,skill TEXT NOT NULL,project TEXT,agent TEXT,occurred_at INTEGER NOT NULL,session_id TEXT NOT NULL,evidence TEXT NOT NULL,source TEXT NOT NULL,source_ref TEXT,excerpt TEXT); CREATE UNIQUE INDEX IF NOT EXISTS usage_identity ON usage_events(source,session_id,skill); CREATE INDEX IF NOT EXISTS usage_time ON usage_events(occurred_at);")
    uid=hashlib.sha256(("workflow|"+rid+"|"+skill).encode()).hexdigest(); uc.execute("INSERT OR IGNORE INTO usage_events VALUES(?,?,?,?,?,?,?,?,?,?)",(uid,cand['name'],project_scope(root,r[2]),r[4],now(),rid,'explicit_invocation','workflow',rid,'workflow run')); uc.commit(); uc.close()
    print(json.dumps({"run_id":rid,"status":status,"exit_code":proc.returncode,"stdout":proc.stdout[-MAX_OUT:],"stderr":proc.stderr[-MAX_OUT:]})); return proc.returncode or (0 if status=="succeeded" else 1)
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--root',type=Path,default=DEFAULT_ROOT); ap.add_argument('--home',type=Path,default=Path.home())
    sp=ap.add_subparsers(dest='cmd',required=True); sp.add_parser('refresh'); sp.add_parser('snapshot')
    q=sp.add_parser('recommend'); q.add_argument('--project',required=True); q.add_argument('--task',required=True); q.add_argument('--agent',default='codex')
    r=sp.add_parser('run'); r.add_argument('--run-id',required=True); r.add_argument('--skill',required=True); r.add_argument('--artifact',action='append',default=[]); r.add_argument('command',nargs=argparse.REMAINDER)
    a=ap.parse_args(); root=validate_root(a.root)
    if a.cmd=='refresh': print(json.dumps(refresh(root,a.home),ensure_ascii=False)); return
    if a.cmd=='snapshot': print(json.dumps(snapshot(root),ensure_ascii=False)); return
    if a.cmd=='recommend': print(json.dumps(recommend(root,a.project,a.task,a.agent,a.home),ensure_ascii=False)); return
    if a.cmd=='run':
        argv=a.command[1:] if a.command and a.command[0]=='--' else a.command
        raise SystemExit(run_cmd(root,a.run_id,a.skill,argv,a.artifact))
if __name__=='__main__': main()
