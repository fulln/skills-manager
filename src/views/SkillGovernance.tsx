import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Network, Plus, RefreshCw } from 'lucide-react';
import { governanceAddScope, governanceAttachSkill, governanceCatalog, governanceEffectiveSkills, governanceListScopes, governanceRemoveSkill, governanceReparentScope } from '../lib/governance';
import type { GovernanceSkill, Scope, ScopeKind, ScopeSkill, SkillRole } from '../lib/governance';

const kindLabel: Record<ScopeKind, string> = { global: '全局', domain: '领域', project: '项目' };
const roleLabel: Record<SkillRole, string> = { orchestration: '流程编排', specialist: '专项能力', primitive: '基础能力' };
export function SkillGovernance() {
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [skills, setSkills] = useState<GovernanceSkill[]>([]);
  const [selected, setSelected] = useState('');
  const [effective, setEffective] = useState<ScopeSkill[]>([]);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [kind, setKind] = useState<ScopeKind>('global');
  const [parent, setParent] = useState('');
  const [newParent, setNewParent] = useState('');
  const [skill, setSkill] = useState('');
  const [role, setRole] = useState<SkillRole>('specialist');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const [s, catalog] = await Promise.all([governanceListScopes(), governanceCatalog()]);
    setScopes(s); setSkills(catalog); setSelected(current => current || s.find(x => x.kind === 'global')?.id || s[0]?.id || '');
  }, []);
  useEffect(() => {
    let active = true;
    void refresh().catch(e => { if (active) setError(String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  const current = scopes.find(s => s.id === selected);
  useEffect(() => {
    const id = ++generation.current;
    if (!selected) return;
    void governanceEffectiveSkills(selected).then(rows => { if (id === generation.current) setEffective(rows); }).catch(e => { if (id === generation.current) setError(String(e)); });
    return () => { generation.current += 1; };
  }, [selected, scopes]);
  useEffect(() => { setNewParent(current?.parent_id || ''); }, [current?.parent_id, selected]);
  const byParent = useMemo(() => {
    const m = new Map<string | null, Scope[]>();
    scopes.forEach(s => m.set(s.parent_id, [...(m.get(s.parent_id) || []), s]));
    return m;
  }, [scopes]);
  const parentsFor = (k: ScopeKind, exclude?: string) => scopes.filter(s => s.id !== exclude && k !== 'global' && (k !== 'domain' || s.kind !== 'project'));
  async function change(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await action(); await refresh(); if (selected) setEffective(await governanceEffectiveSkills(selected)); }
    catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  const add = () => change(async () => {
    const created = await governanceAddScope(name, kind, kind === 'project' ? path || null : null, parent || null);
    setName(''); setPath(''); setSelected(created.id);
    if (kind === 'global') { setKind('domain'); setParent(created.id); }
  });
  function tree(parentId: string | null, depth = 0): React.ReactNode {
    if (depth > scopes.length) return null;
    return (byParent.get(parentId) || []).map(s => <div key={s.id}><button disabled={busy} aria-pressed={selected === s.id} className={`w-full text-left px-3 py-2 rounded-md text-[13px] ${selected === s.id ? 'bg-accent-bg text-accent font-medium' : 'text-secondary hover:bg-bg-secondary'}`} style={{ paddingLeft: 12 + depth * 14 }} onClick={() => setSelected(s.id)}>{kindLabel[s.kind]} · {s.name}</button>{tree(s.id, depth + 1)}</div>);
  }
  return <div className="app-page app-page-narrow">
    <div className="app-page-header"><h1 className="app-page-title">项目层级与技能职责</h1><p className="app-page-subtitle text-tertiary">全局 → 领域 → 项目。下级继承技能，也可以覆盖职责或排除上级技能。</p></div>
    {error && <div role="alert" className="app-panel p-4 text-[13px] text-red-600 dark:text-red-400">{error}</div>}
    <div className="grid grid-cols-[260px_minmax(0,1fr)] gap-4">
      <aside className="app-panel p-3 space-y-4">
        <h2 className="text-[14px] font-medium flex gap-2 items-center"><Network className="h-4 w-4" />项目与作用域</h2>
        {loading ? <p className="text-[13px] text-tertiary">正在读取…</p> : scopes.length ? tree(null) : <p className="text-[13px] text-tertiary">先创建全局技能层，再添加领域和项目。</p>}
        <div className="border-t border-border-subtle pt-4 space-y-3">
          <h3 className="text-[13px] font-medium">新建作用域</h3>
          <input aria-label="作用域名称" className="app-input w-full" value={name} onChange={e => setName(e.target.value)} placeholder="例如：内容生产、投研社" disabled={busy} />
          <select aria-label="作用域级别" className="app-input w-full" value={kind} onChange={e => { setKind(e.target.value as ScopeKind); setParent(''); }} disabled={busy}>{Object.entries(kindLabel).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
          {kind === 'project' && <input aria-label="项目路径" className="app-input w-full" value={path} onChange={e => setPath(e.target.value)} placeholder="项目绝对路径（可选）" disabled={busy} />}
          {kind !== 'global' && <select aria-label="新作用域父级" className="app-input w-full" value={parent} onChange={e => setParent(e.target.value)} disabled={busy}><option value="">无父级</option>{parentsFor(kind).map(s => <option key={s.id} value={s.id}>{kindLabel[s.kind]} · {s.name}</option>)}</select>}
          <button className="app-button-primary w-full" onClick={() => void add()} disabled={!name.trim() || busy}><Plus className="h-4 w-4" />创建</button>
        </div>
      </aside>
      <main className="space-y-4 min-w-0">
        {current ? <>
          <section className="app-panel p-4 space-y-3"><h2 className="text-[14px] font-medium">{current.name} <span className="text-[12px] text-tertiary">{kindLabel[current.kind]}</span></h2><p className="text-[12px] text-tertiary break-all">{current.project_path || '未绑定项目目录'} · 仅管理作用域元数据</p>{current.kind !== 'global' && <div className="flex gap-2"><select aria-label="调整父级" className="app-input min-w-0 flex-1" value={newParent} onChange={e => setNewParent(e.target.value)} disabled={busy}><option value="">无父级</option>{parentsFor(current.kind, selected).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><button className="app-button-secondary" disabled={busy || newParent === (current.parent_id || '')} onClick={() => void change(() => governanceReparentScope(selected, newParent || null))}>调整父级</button></div>}</section>
          <section className="app-panel overflow-hidden"><h2 className="p-4 text-[14px] font-medium">有效技能 <span className="text-[12px] text-tertiary">{effective.filter(s => !s.excluded).length} 项生效</span></h2>
            {effective.length ? effective.map(x => <div key={x.skill_id} className="p-4 border-t border-border-subtle space-y-2"><div className="flex gap-3 items-start justify-between"><div className="min-w-0"><p className="text-[13px] font-medium break-all">{skills.find(s => s.id === x.skill_id)?.name || x.skill_id}</p><p className="text-[12px] text-tertiary mt-1">{x.excluded ? '已排除' : x.inherited ? '继承' : x.overridden ? '本地覆盖' : '本地绑定'} · 来源：{scopes.find(s => s.id === x.origin_scope_id)?.name || x.origin_scope_id}</p></div><select aria-label={`${x.skill_id}职责`} className="app-input" value={x.role} disabled={busy} onChange={e => void change(() => governanceAttachSkill(selected, x.skill_id, e.target.value as SkillRole, x.excluded))}>{Object.entries(roleLabel).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div><div className="flex gap-2"><button className="app-button-secondary" disabled={busy} onClick={() => void change(() => governanceAttachSkill(selected, x.skill_id, x.role, !x.excluded))}>{x.excluded ? '在本层恢复' : '在本层排除'}</button>{!x.inherited && <button className="app-button-secondary" disabled={busy} onClick={() => void change(() => governanceRemoveSkill(selected, x.skill_id))}><RefreshCw className="h-3 w-3" />{x.overridden ? '恢复上级规则' : '移除本层绑定'}</button>}</div></div>) : <p className="p-4 text-[13px] text-tertiary">暂无技能。可以在此绑定，或选择一个父级继承技能。</p>}
          </section>
          <section className="app-panel p-4 space-y-3"><h2 className="text-[14px] font-medium">绑定或覆盖技能</h2><div className="flex flex-wrap gap-2"><select aria-label="绑定技能" className="app-input flex-1 min-w-32" value={skill} disabled={busy} onChange={e => setSkill(e.target.value)}><option value="">选择技能</option>{skills.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><select aria-label="技能职责" className="app-input" value={role} disabled={busy} onChange={e => setRole(e.target.value as SkillRole)}>{Object.entries(roleLabel).map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select><button className="app-button-primary" disabled={!skill || busy} onClick={() => void change(async () => { await governanceAttachSkill(selected, skill, role, false); setSkill(''); })}>绑定</button></div>{!skills.length && <p className="text-[12px] text-tertiary">开发库暂无技能。先用独立快照工具复制技能内容，再启动开发版。</p>}</section>
        </> : <div className="app-panel p-8 text-[13px] text-tertiary">创建或选择一个作用域，查看其有效技能。</div>}
      </main>
    </div>
  </div>;
}
