import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Download, FolderArchive, Pencil, RefreshCw, Search, X } from 'lucide-react';
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

const categories = [
  { id: 'local_packaged' as SkillCategory, title: '本地封装', description: '本机或项目内维护的技能，适合持续迭代。', Icon: FolderArchive, tone: 'text-violet-500' },
  { id: 'downloaded' as SkillCategory, title: '下载', description: '从外部来源获取、来源可核对的技能。', Icon: Download, tone: 'text-sky-500' },
  { id: 'downloaded_modified' as SkillCategory, title: '下载后改动', description: '基于下载版本做过本地调整的技能。', Icon: Pencil, tone: 'text-amber-500' },
];
const time = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '暂无';
const categoryOf = (s: WorkflowSkill): SkillCategory => s.category_override || s.category || s.detected_category || 'local_packaged';
const sourceLabel = (value: string | null | undefined) => ({ local: '本地来源', import: '已导入', git: 'Git 仓库', skillssh: '技能市场', 'project-local': '项目目录' }[value || ''] || value || '本地发现');
const scopeLabel = (s: string) => s === 'global' ? '全局' : s === 'domain' ? '领域' : '项目';

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
  const detected = skill.detected_category || skill.category || 'local_packaged';
  return <div className="fixed inset-0 z-50 flex items-center justify-center"><button aria-label="关闭分类配置" disabled={saving} className="absolute inset-0 bg-black/65" onClick={() => !saving && onClose()} /><div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="skill-category-title" className="relative app-panel w-full max-w-lg p-5 shadow-2xl"><div className="flex items-start justify-between"><div><h2 id="skill-category-title" className="text-[14px] font-semibold">配置技能分类</h2><p className="text-[12px] text-tertiary mt-1">{skill.name}</p></div><button aria-label="关闭分类配置" disabled={saving} className="app-icon-button" onClick={onClose}><X size={16} /></button></div><div className="mt-4 space-y-3"><label htmlFor="skill-category-select" className="text-[12px] text-secondary">分类</label><select id="skill-category-select" ref={selectRef} disabled={saving} className="app-input w-full" value={value} onChange={e => setValue(e.target.value as SkillCategory | 'auto')}><option value="auto">自动识别（{categories.find(c => c.id === detected)?.title}）</option>{categories.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select><div className="rounded-lg bg-background p-3 text-[12px] text-tertiary space-y-1"><p>来源：{sourceLabel(skill.source)}</p><p className="break-all">路径：{skill.canonical_path || skill.path}</p>{skill.source_ref && <p className="break-all">来源地址：{skill.source_ref}</p>}{skill.category_reason && <p>识别依据：{skill.category_reason}</p>}</div>{error && <p role="alert" className="text-[12px] text-red-500">{error}</p>}</div><div className="mt-5 flex justify-end gap-2"><button className="app-button-secondary" disabled={saving} onClick={onClose}>取消</button><button className="app-button-primary" onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存分类'}</button></div></div></div>;
}

export function SkillWorkflow() {
  const navigate = useNavigate(); const { managedSkills, openSkillDetailById } = useApp();
  const [data, setData] = useState<WorkflowSnapshot | null>(null); const [projectPath, setProjectPath] = useState(''); const [projectQuery, setProjectQuery] = useState(''); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<SkillCategory>('local_packaged'); const [config, setConfig] = useState<WorkflowSkill | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [summaries, setSummaries] = useState<UsageSummary[] | null>(null);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [usageError, setUsageError] = useState('');
  const [days, setDays] = useState(30);
  const [sort, setSort] = useState('frequency');
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
  const skills = useMemo(() => scopedSkills.filter(s => categoryOf(s) === selected && `${s.name} ${s.description || ''} ${s.path}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => (sort === 'frequency' && frequencyReady ? (frequencies.get(b.name)?.explicit || 0) - (frequencies.get(a.name)?.explicit || 0) : 0) || a.name.localeCompare(b.name)), [scopedSkills, selected, search, sort, frequencies, frequencyReady]);
  const counts = useMemo(() => categories.reduce((a, c) => ({ ...a, [c.id]: scopedSkills.filter(s => categoryOf(s) === c.id).length }), {} as Record<SkillCategory, number>), [scopedSkills]);
  return <div className="app-page app-page-narrow gap-4"><div className="app-page-header !pb-3 flex items-start justify-between gap-4"><div><h1 className="app-page-title">技能</h1><p className="app-page-subtitle text-tertiary">按来源管理技能，查看实际调用频率。</p></div><div className="flex items-center gap-2"><SkillManagementActions compact /><button className="app-button-secondary" onClick={() => { void load(true); void loadUsage(); }} disabled={loading}><RefreshCw className="h-4 w-4" />刷新</button></div></div>{error && <div role="alert" className="app-panel p-4 text-[13px] text-red-500">{error}</div>}<div className="flex items-center justify-between text-[12px]"><span className="flex items-center gap-2"><Activity size={16} />{data?.sync.running ? '正在同步真实项目和技能…' : data?.sync.error ? `同步异常：${data.sync.error}` : `已同步 ${data?.sync.project_count || 0} 个项目、${data?.sync.skill_count || 0} 个技能`}</span><span className="text-[12px] text-tertiary">最近刷新：{time(data?.sync.last_refresh || null)}</span></div><section className="app-panel p-3 flex items-center gap-3"><h2 className="text-[12px] font-medium shrink-0">项目范围</h2><div className="flex gap-2 flex-1 min-w-0"><input aria-label="搜索项目" className="app-input flex-1" placeholder="搜索项目名称或路径" value={projectQuery} onChange={e => setProjectQuery(e.target.value)} /><select aria-label="当前项目" className="app-input max-w-[50%]" value={project?.path || ''} onChange={e => setProjectPath(e.target.value)}><option value="">全部项目</option>{(data?.projects || []).filter(p => !projectQuery || `${p.name} ${p.path}`.toLowerCase().includes(projectQuery.toLowerCase())).map(p => <option key={p.path} value={p.path}>{p.name} · {p.path}</option>)}</select></div></section><section className="space-y-3"><div><h2 className="text-[14px] font-semibold">技能分类</h2></div><div className="grid grid-cols-1 md:grid-cols-3 gap-3">{categories.map(c => <button key={c.id} aria-pressed={selected === c.id} onClick={() => setSelected(c.id)} className={`app-panel p-3 text-left transition-colors ${selected === c.id ? 'border-accent ring-1 ring-accent/30' : ''}`}><div className="flex items-center justify-between"><c.Icon size={19} className={c.tone} /><span className="text-[17px] font-semibold">{counts[c.id] || 0}</span></div><p className="text-[14px] font-medium mt-2">{c.title}</p><p className="text-[12px] text-tertiary mt-1 leading-5">{c.description}</p></button>)}</div></section><section className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><label className="text-[12px] text-secondary">时间 <select aria-label="卡片统计时间" className="app-input" value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(d => <option key={d} value={d}>近 {d} 天</option>)}</select></label><select aria-label="技能排序" className="app-input" value={sort} onChange={e => setSort(e.target.value)}><option value="frequency">调用频率优先</option><option value="name">按名称</option></select></div><button className="text-[12px] text-secondary underline" onClick={() => navigate('/skill-usage')}>查看统计与证据</button></div><p className="text-[12px] text-tertiary">明确调用按已采集会话计数；声明和读取另列。暂无记录不代表未使用。{usageError ? '统计暂不可用，请到统计页重试。' : project && !scopeId ? '当前项目尚无可匹配的统计范围。' : ''}</p><div className="flex items-center justify-between gap-3"><h2 className="text-[14px] font-medium">{categories.find(c => c.id === selected)?.title} <span className="text-tertiary">· {skills.length}</span></h2><div className="relative w-56"><Search size={14} className="absolute left-2.5 top-2.5 text-tertiary" /><input aria-label="搜索技能" className="app-input w-full pl-8" placeholder="搜索技能" value={search} onChange={e => setSearch(e.target.value)} /></div></div>{loading && !data ? <p className="text-[13px] text-tertiary">正在自动发现项目…</p> : skills.length ? <div className="grid grid-cols-1 md:grid-cols-2 gap-3">{skills.map(s => <article key={s.id} className="app-panel p-4 flex flex-col gap-2"><div className="flex items-start justify-between gap-3"><div><h3 className="text-[14px] font-medium">{s.name}</h3><p className="text-[12px] text-tertiary mt-1 line-clamp-2">{s.description || '暂无描述'}</p></div><button className="app-icon-button" aria-label={`配置 ${s.name}`} onClick={() => setConfig(s)}><Pencil size={14} /></button></div><div className="flex flex-wrap gap-1.5 text-[11px]"><span className="rounded-full bg-accent-bg px-2 py-1">{sourceLabel(s.source)}</span><span className="rounded-full bg-background px-2 py-1">{scopeLabel(s.scope)}</span>{s.project_id && <span className="rounded-full bg-background px-2 py-1">项目技能</span>}{s.category_override && <span className="rounded-full bg-amber-500/10 text-amber-600 px-2 py-1">手动分类</span>}</div><div className="rounded-lg bg-background px-3 py-2"><div className="flex items-baseline justify-between gap-2"><span className="text-[12px] text-secondary">近 {days} 天明确调用</span><span className="text-[17px] font-semibold tabular-nums">{frequencyReady ? frequencies.get(s.name)?.explicit || 0 : '—'}<span className="text-[12px] font-normal text-tertiary ml-1">次</span></span></div><p className="text-[11px] text-tertiary mt-1">{frequencyReady ? `声明 ${frequencies.get(s.name)?.declared || 0} · 读取 ${frequencies.get(s.name)?.inferred || 0} · 最近证据 ${time(frequencies.get(s.name)?.lastEvidence || null)}` : usageError ? '统计暂不可用' : summaries === null ? '正在读取统计…' : '项目统计未匹配'}</p>{hasNameVariants(data?.skills || [], s.name) && <p className="text-[11px] text-tertiary mt-1">同名技能合计，无法区分副本版本</p>}</div><p className="text-[11px] text-tertiary break-all mt-auto">{s.canonical_path || s.path}</p><div className="flex justify-end gap-2 pt-1">{managedSkills.some(m => m.id === s.id) ? <button className="app-button-secondary text-[12px]" onClick={() => { openSkillDetailById(s.id); navigate('/my-skills'); }}>查看技能</button> : <span className="text-[11px] text-tertiary self-center">项目本地技能</span>}<button className="app-button-secondary text-[12px]" onClick={() => setConfig(s)}>配置</button></div></article>)}</div> : <div className="app-panel p-8 text-center text-[13px] text-tertiary">当前分类没有符合条件的技能。</div>}</section>{config && <SkillConfig skill={config} onClose={closeConfig} onSaved={s => { ++loadSequence.current; setData(s); setConfig(null); }} />}</div>;
}
