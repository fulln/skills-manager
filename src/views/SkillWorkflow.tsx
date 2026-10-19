import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FolderArchive, LayoutGrid, List, Pencil, RefreshCw, Search, X, CircleHelp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { workflowRefresh, workflowSetCategory, workflowSnapshot } from '../lib/workflow';
import type { SkillCategory, WorkflowSkill, WorkflowSnapshot } from '../lib/workflow';
import { SkillManagementActions } from '../components/WorkflowSidebar';
import { governanceListScopes } from '../lib/governance';
import type { Scope } from '../lib/governance';
import { usageSummaries } from '../lib/usage';
import type { UsageSummary } from '../lib/usage';
import { hasNameVariants, skillFrequencies } from '../lib/skillFrequency';
import { SkillInventory } from '../components/SkillInventory';
import { FrequencyLegend } from '../components/FrequencyBadge';

const categories = [
  { id: 'local_packaged' as SkillCategory, title: '本地封装', Icon: FolderArchive },
  { id: 'downloaded' as SkillCategory, title: '下载', Icon: Download },
  { id: 'downloaded_modified' as SkillCategory, title: '下载后改动', Icon: Pencil },
  { id: 'unknown' as SkillCategory, title: '来源待核对', Icon: CircleHelp },
];
const time = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '暂无';
const categoryOf = (s: WorkflowSkill): SkillCategory => s.category_override || s.category || s.detected_category || 'unknown';
const sourceLabel = (value: string | null | undefined) => ({ local: '本地来源', import: '已导入', git: 'Git 仓库', skillssh: '技能市场', 'project-local': '项目目录' }[value || ''] || value || '本地发现');

function SkillConfig({ skill, onClose, onSaved }: { skill: WorkflowSkill; onClose: () => void; onSaved: (s: WorkflowSnapshot) => void }) {
  const [value, setValue] = useState<SkillCategory | 'auto'>(skill.category_override || 'auto');
  const dialogRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null); const previousFocus = useRef<HTMLElement | null>(document.activeElement as HTMLElement);
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    const focused = previousFocus.current;
    selectRef.current?.focus();
    return () => focused?.focus();
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const items = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])');
      if (!items?.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [onClose, saving]);
  const save = async () => { setSaving(true); setError(''); try { onSaved(await workflowSetCategory(skill.id, value)); } catch (e) { setError(String(e)); } finally { setSaving(false); } };
  const detected = skill.detected_category || skill.category || 'unknown';
  return <div className="fixed inset-0 z-50 flex items-center justify-center"><button aria-label="关闭分类配置" disabled={saving} className="absolute inset-0 bg-black/65" onClick={() => !saving && onClose()} /><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="skill-category-title" className="relative app-panel w-full max-w-lg p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="skill-category-title" className="text-[14px] font-semibold">技能来源与配置</h2><p className="text-[12px] text-tertiary mt-1">{skill.name}</p></div><button aria-label="关闭分类配置" disabled={saving} className="app-icon-button" onClick={onClose}><X size={16} /></button></div><div className="mt-4 space-y-3"><p className="text-[12px] text-secondary">{skill.description || '暂无描述'}</p><p className="text-[12px] text-tertiary">{skill.scope === 'global' ? '全局技能' : skill.scope === 'domain' ? '领域技能' : '项目技能'} · {skill.role === 'orchestration' ? '编排' : skill.role === 'primitive' ? '基础' : '专用'}</p><label htmlFor="skill-category-select" className="text-[12px] text-secondary">分类</label><select id="skill-category-select" ref={selectRef} disabled={saving} className="app-input w-full" value={value} onChange={e => setValue(e.target.value as SkillCategory | 'auto')}><option value="auto">自动识别（{categories.find(c => c.id === detected)?.title}）</option>{categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><div className="rounded-lg bg-background p-3 text-[12px] text-tertiary space-y-1"><p>来源：{sourceLabel(skill.source)}</p><p className="break-all">路径：{skill.canonical_path || skill.path}</p>{skill.source_ref && <p className="break-all">来源地址：{skill.source_ref}</p>}{skill.category_reason && <p>识别依据：{skill.category_reason}</p>}</div>{error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}</div><div className="mt-5 flex justify-end gap-2"><button className="app-button-secondary" disabled={saving} onClick={onClose}>取消</button><button className="app-button-primary" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存分类'}</button></div></div></div>;
}

export function SkillWorkflow() {
  const navigate = useNavigate(); const { managedSkills, openSkillDetailById } = useApp();
  const [data, setData] = useState<WorkflowSnapshot | null>(null); const [projectPath, setProjectPath] = useState(''); const [projectQuery, setProjectQuery] = useState(''); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<SkillCategory | 'all'>('all'); const [config, setConfig] = useState<WorkflowSkill | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [summaries, setSummaries] = useState<UsageSummary[] | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [usageError, setUsageError] = useState('');
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState('frequency');
  const [view, setView] = useState<'list' | 'cards'>(() => localStorage.getItem('skills-workbench-view') === 'cards' ? 'cards' : 'list');
  const [attention, setAttention] = useState('all');
  const loadSequence = useRef(0);
  const closeConfig = useCallback(() => setConfig(null), []);
  const load = useCallback(async (refresh = false) => { const sequence = ++loadSequence.current; setError(''); try { const next = refresh ? await workflowRefresh() : await workflowSnapshot(); if (sequence === loadSequence.current) setData(next); } catch (e) { if (sequence === loadSequence.current) setError(String(e)); } finally { if (sequence === loadSequence.current) setLoading(false); } }, []);
  const usageSequence = useRef(0);
  const loadUsage = useCallback(async () => {
    const sequence = ++usageSequence.current;
      try {
        const [rows, projects] = await Promise.all([usageSummaries(null), governanceListScopes()]);
        if (sequence === usageSequence.current) { setSummaries(rows); setScopes(projects); setUsageError(''); }
      } catch (e) { if (sequence === usageSequence.current) setUsageError(String(e)); }
  }, []);
  useEffect(() => {
    const sequence = usageSequence;
    void loadUsage();
    const timer = window.setInterval(() => void loadUsage(), 30000);
    return () => { ++sequence.current; window.clearInterval(timer); };
  }, [loadUsage]);
  useEffect(() => { void load(); const id = window.setInterval(() => void load(), 30000); return () => window.clearInterval(id); }, [load]);
  const project = useMemo(() => projectPath ? data?.projects.find(p => p.path === projectPath) : undefined, [data, projectPath]);
  const scopedSkills = useMemo(() => { const candidates = (data?.skills || []).filter(s => (!project || !s.project_id || s.project_id === project.id) && (!project?.effective_skill_ids || project.effective_skill_ids.includes(s.id))); const seen = new Set<string>(); return candidates.sort((a, b) => Number(!a.tags?.includes('现用')) - Number(!b.tags?.includes('现用')) || Number(!managedSkills.some(m => m.id === a.id)) - Number(!managedSkills.some(m => m.id === b.id)) || Number(a.scope !== 'global') - Number(b.scope !== 'global')).filter(s => { const key = s.canonical_path || s.path; if (seen.has(key)) return false; seen.add(key); return true; }); }, [data, project, managedSkills]);
  const scopeId = project ? scopes.find(s => s.kind === 'project' && s.project_path === project.path)?.id : null;
  const frequencies = useMemo(() => skillFrequencies(summaries || [], days, project ? scopeId || '__unmapped_project__' : null), [summaries, days, project, scopeId]);
  const frequencyReady = summaries !== null && !usageError && (!project || !!scopeId);
  const skills = useMemo(() => scopedSkills.filter(s => (selected === 'all' || categoryOf(s) === selected) && (attention === 'all' || (frequencyReady && (attention === 'used' ? (frequencies.get(s.name)?.explicit || 0) > 0 : (frequencies.get(s.name)?.explicit || 0) === 0))) && `${s.name} ${s.description || ''} ${s.path}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (sort === 'frequency' && frequencyReady ? (frequencies.get(b.name)?.explicit || 0) - (frequencies.get(a.name)?.explicit || 0) : 0) || a.name.localeCompare(b.name)), [scopedSkills, selected, search, sort, frequencies, frequencyReady, attention]);
  const counts = useMemo(() => categories.reduce((a, c) => ({ ...a, [c.id]: scopedSkills.filter(s => categoryOf(s) === c.id).length }), {} as Record<SkillCategory, number>), [scopedSkills]);
  const variants = useMemo(() => new Set(scopedSkills.filter(s => hasNameVariants(scopedSkills, s.name)).map(s => s.name)), [scopedSkills]);
  const usedCount = frequencyReady ? scopedSkills.filter(s => (frequencies.get(s.name)?.explicit || 0) > 0).length : null;
  const chooseCategory = (category: SkillCategory | 'all') => { setSelected(category); setAttention('all'); };
  return <div className="app-page gap-4">
    <header className="flex items-center justify-between gap-4">
      <div><h1 className="app-page-title">技能工作台</h1><p className="text-[12px] text-secondary mt-1">管理已有技能 · 比较实际使用 · 核查优化对象</p></div>
      <div className="flex items-center gap-2"><button className="app-button-primary" onClick={() => navigate('/install')}><Download size={14} />安装技能</button><SkillManagementActions compact /><button className="app-icon-button" aria-label="刷新技能与统计" title="刷新技能与统计" onClick={() => { void load(true); void loadUsage(); }} disabled={loading}><RefreshCw size={16} /></button></div>
    </header>
    {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    <div className="grid grid-cols-4 gap-3">
      {[
        { label: '当前范围技能', value: scopedSkills.length, detail: '按物理目录去重', active: selected === 'all' && attention === 'all', action: () => chooseCategory('all') },
        { label: '有明确调用', value: usedCount ?? '—', detail: `近 ${days} 天 · 按名称证据`, active: attention === 'used', action: () => { setSelected('all'); setAttention('used'); }, disabled: !frequencyReady },
        { label: '下载后改动', value: counts.downloaded_modified || 0, detail: '复核本地调整', active: selected === 'downloaded_modified', action: () => chooseCategory('downloaded_modified') },
        { label: '来源待核对', value: counts.unknown || 0, detail: '先核实出处，再分类', active: selected === 'unknown', action: () => chooseCategory('unknown') },
      ].map(metric => <button key={metric.label} disabled={metric.disabled} aria-pressed={metric.active} onClick={metric.action} className={`app-panel px-4 py-3 text-left ${metric.active ? 'border-accent' : ''}`}><p className="text-[12px] text-secondary">{metric.label}</p><div className="flex items-baseline gap-3 mt-1"><strong className="text-[17px] tabular-nums">{metric.value}</strong><span className="text-[11px] text-tertiary">{metric.detail}</span></div></button>)}
    </div>
    <section className="app-panel p-3 space-y-3" aria-label="技能筛选">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-40"><Search size={14} className="absolute left-2.5 top-3 text-tertiary" /><input aria-label="搜索技能" className="app-input w-full pl-8" placeholder="搜索技能、用途或路径" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <details className="relative"><summary className="app-button-secondary cursor-pointer list-none">项目：{project?.name || '全部项目'}</summary><div className="absolute right-0 top-full mt-2 z-20 app-panel w-96 p-3 space-y-2 shadow-xl"><input aria-label="搜索项目" className="app-input w-full" placeholder="搜索现有项目" value={projectQuery} onChange={e => setProjectQuery(e.target.value)} /><select aria-label="当前项目" className="app-input w-full" value={projectPath} onChange={e => { setProjectPath(e.target.value); e.currentTarget.closest('details')?.removeAttribute('open'); }}><option value="">全部项目</option>{(data?.projects || []).filter(p => p.path === projectPath || !projectQuery || `${p.name} ${p.path}`.toLowerCase().includes(projectQuery.toLowerCase())).map(p => <option key={p.path} value={p.path}>{p.name} · {p.path}</option>)}</select><p className="text-[11px] text-tertiary">按项目继承与覆盖规则展示有效技能。</p></div></details>
        <select aria-label="统计时间" className="app-input" value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(d => <option key={d} value={d}>近 {d} 天</option>)}</select>
        <select aria-label="技能排序" className="app-input" value={sort} onChange={e => setSort(e.target.value)}><option value="frequency">调用频率优先</option><option value="name">按名称</option></select>
        <div className="flex rounded-lg border border-border-subtle p-1">{([{ id: 'list', label: '列表视图', Icon: List }, { id: 'cards', label: '卡片视图', Icon: LayoutGrid }] as const).map(v => <button key={v.id} aria-label={v.label} title={v.label} aria-pressed={view === v.id} className={`app-icon-button ${view === v.id ? 'bg-accent-bg' : ''}`} onClick={() => { setView(v.id); localStorage.setItem('skills-workbench-view', v.id); }}><v.Icon size={15} /></button>)}</div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1"><button aria-pressed={selected === 'all'} className={`rounded-lg px-3 py-1.5 text-[12px] ${selected === 'all' ? 'bg-accent-bg text-primary' : 'text-secondary hover:bg-surface-hover'}`} onClick={() => chooseCategory('all')}>全部 {scopedSkills.length}</button>{categories.map(c => <button key={c.id} aria-pressed={selected === c.id} onClick={() => chooseCategory(c.id)} className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] ${selected === c.id ? 'bg-accent-bg text-primary' : 'text-secondary hover:bg-surface-hover'}`}><c.Icon size={13} />{c.title}<span className="text-tertiary tabular-nums">{counts[c.id] || 0}</span></button>)}</div>
        <select aria-label="使用情况筛选" className="app-input text-[12px]" value={attention} onChange={e => setAttention(e.target.value)}><option value="all">全部使用情况</option><option value="used" disabled={!frequencyReady}>有明确调用</option><option value="no_explicit" disabled={!frequencyReady}>暂无明确调用</option></select>
      </div>
    </section>
    <div className="flex items-center justify-between gap-3 text-[11px] text-tertiary"><p>{loading && !data ? '正在发现真实项目…' : `显示 ${skills.length} / ${scopedSkills.length} 个技能 · ${data?.projects.length || 0} 个项目`} · {data?.sync.running ? '正在同步…' : data?.sync.error ? `同步异常：${data.sync.error}` : `刷新 ${time(data?.sync.last_refresh || null)}`}</p><FrequencyLegend days={days} /><button className="underline text-secondary shrink-0" onClick={() => navigate('/skill-usage')}>统计与证据 ↗</button></div>
    {usageError ? <p role="alert" className="text-[12px] text-danger">统计暂不可用：{usageError}</p> : project && !scopeId ? <p className="text-[12px] text-secondary">当前项目尚未匹配统计范围。</p> : null}
    {skills.length ? <SkillInventory skills={skills} managed={managedSkills} frequencies={frequencies} variants={variants} ready={!!frequencyReady} availability={usageError ? 'unavailable' : project && !scopeId ? 'unmatched' : 'loading'} days={days} view={view} onInspect={setConfig} onOpen={id => { openSkillDetailById(id); navigate('/my-skills'); }} /> : <div className="app-panel p-8 text-center text-[13px] text-secondary">{loading && !data ? '正在读取技能清单…' : '当前筛选没有符合条件的技能。'}</div>}
    <p className="text-[11px] text-tertiary">调用按已采集来源会话去重；声明与读取另列，零记录不代表未使用。同名证据无法区分副本版本。来源待核对项不会算作本地原创；下载后改动可作为复核候选，不代表质量有问题。</p>
    {config && <SkillConfig skill={config} onClose={closeConfig} onSaved={s => { ++loadSequence.current; setData(s); setConfig(null); }} />}
  </div>;
}
