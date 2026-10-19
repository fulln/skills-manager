import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Pause, Play, RefreshCw, Trash2 } from 'lucide-react';
import { SkillUsageFlow } from './SkillUsageFlow';
import { usageLivePoll, evidenceLabels as labels } from '../lib/liveUsage';
import type { LiveEvidence, LiveUsageEvent } from '../lib/liveUsage';
import { clearLiveUsage, mergeLiveUsage, type LiveUsageBuffer } from '../lib/liveUsageBuffer';

const date = (ts: number) => new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function SkillConsole({ onOpenSkill }: { onOpenSkill: (event: LiveUsageEvent) => void }) {
  const [open, setOpen] = useState(true); const [paused, setPaused] = useState(false); const [buffer, setBuffer] = useState<LiveUsageBuffer>({ events: [], ignored: new Set() }); const [agent, setAgent] = useState(''); const [project, setProject] = useState(''); const [evidence, setEvidence] = useState<LiveEvidence | ''>(''); const [error, setError] = useState(''); const [checked, setChecked] = useState<number | null>(null); const [coverage, setCoverage] = useState(''); const [scanned, setScanned] = useState<number | null>(null); const running = useRef(false); const refresh = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!open || paused) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!cancelled && !document.hidden) timer = window.setTimeout(() => void poll(), 30000);
    };
    const poll = async () => {
      if (cancelled || document.hidden) return;
      if (running.current) { schedule(); return; }
      running.current = true;
      try {
        const result = await usageLivePoll();
        if (!cancelled && !document.hidden) {
          setChecked(result.checked_at); setCoverage(result.coverage_note); setScanned(result.files_scanned); setError('');
          setBuffer(prev => mergeLiveUsage(prev, result.events));
        }
      } catch (e) { if (!cancelled && !document.hidden) setError(String(e)); }
      finally { running.current = false; schedule(); }
    };
    const visibility = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!document.hidden) void poll();
    };
    refresh.current = () => void poll();
    void poll(); document.addEventListener('visibilitychange', visibility);
    return () => { refresh.current = null; cancelled = true; if (timer !== undefined) window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [open, paused]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const events = buffer.events;
  const filtered = useMemo(() => events.filter(e => (!agent || e.agent === agent) && (!project || (project === '__none__' ? !e.project_path : e.project_path === project)) && (!evidence || e.evidence === evidence)), [events, agent, project, evidence]);
  const agents = [...new Set([...events.map(e => e.agent).filter(Boolean), ...(agent ? [agent] : [])])] as string[]; const projects = [...new Set([...events.map(e => e.project_path).filter(Boolean), ...(project && project !== '__none__' ? [project] : [])])] as string[];
  const selected = filtered.find(e => e.id === selectedId) || filtered[0] || null;
  return <section className="app-panel overflow-hidden" aria-label="技能控制台">
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex items-center gap-2 text-[13px] font-semibold"><ChevronDown size={15} className={open ? 'rotate-180' : ''} />关系与证据 <span className="text-[11px] font-normal text-tertiary">{filtered.length} 条</span></button>
      <div className="flex items-center gap-2 text-[11px] text-tertiary"><span role="status">{paused ? '已暂停' : checked ? `最近检查 ${date(checked)}` : '正在连接本地日志'} · 完成后30秒再检查</span>{open && <><button type="button" aria-label="立即刷新控制台" title="立即刷新控制台" disabled={paused} className="app-icon-button" onClick={() => refresh.current?.()}><RefreshCw size={14} /></button><button type="button" aria-label={paused ? '继续采集' : '暂停采集'} className="app-icon-button" onClick={() => setPaused(v => !v)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button><button type="button" aria-label="清空显示" className="app-icon-button" onClick={() => { setSelectedId(null); setBuffer(prev => clearLiveUsage(prev)); }}><Trash2 size={14} /></button></>}</div>
    </div>
    {open && <div className="border-t border-border-subtle px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2"><select aria-label="Agent筛选" className="app-input text-[11px]" value={agent} onChange={e => setAgent(e.target.value)}><option value="">全部 Agent</option>{agents.map(a => <option key={a}>{a}</option>)}</select><select aria-label="项目筛选" className="app-input min-w-0 max-w-[360px] text-[11px]" value={project} onChange={e => setProject(e.target.value)}><option value="">全部项目</option><option value="__none__">未归属项目</option>{projects.map(p => <option key={p} value={p}>{p.split('/').filter(Boolean).at(-1)} · {p}</option>)}</select><select aria-label="证据类型筛选" className="app-input text-[11px]" value={evidence} onChange={e => setEvidence(e.target.value as LiveEvidence | '')}><option value="">全部证据</option>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><span className="ml-auto text-[11px] text-tertiary">本地日志 + Dev 桥接 · 非 nmem 实时流</span></div>
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
      <SkillUsageFlow events={filtered} selectedId={selected?.id} onSelect={setSelectedId} onOpenSkill={onOpenSkill} />
      {selected ? <>
        <p className="line-clamp-2 text-[12px] text-secondary" title={selected.excerpt || undefined}><span className="mr-2 text-tertiary">{selected.skill} · {labels[selected.evidence]}</span>{selected.excerpt || '该事件未提供对话片段。'}</p>
        <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="近期技能事件">{filtered.slice(0, 20).map(e => <button type="button" key={e.id} aria-pressed={e.id === selected.id} onClick={() => setSelectedId(e.id)} className={`shrink-0 rounded-lg border px-2.5 py-1.5 text-left text-[11px] ${e.id === selected.id ? 'border-accent-border bg-accent-bg' : 'border-border-subtle hover:bg-surface-hover'}`}><span className="text-tertiary">{date(e.occurred_at)} · {labels[e.evidence]}</span><strong className="ml-2 font-medium">{e.skill}</strong></button>)}</div>
        <details className="text-[11px] text-tertiary"><summary className="cursor-pointer">查看来源与采集范围{scanned !== null ? ` · 扫描 ${scanned} 文件` : ''}</summary><p className="mt-1 break-all">来源：{selected.source_ref || '未提供来源位置'}</p><p className="mt-1">{coverage}</p><p className="mt-1">连线是证据关联，不代表执行顺序或成功。仅展示已落盘证据，短片段只在内存；声明、读取不代表实际执行。显示最近20条，可按项目或Agent缩小范围。</p></details>
      </> : <p className="text-[11px] text-tertiary">{events.length ? '当前筛选没有记录。' : paused ? '已暂停检查。清空显示不会删除统计。' : checked ? '当前没有可显示事件；已清空的事件不会重复显示。' : '正在检查已落盘的技能使用证据…'}</p>}
    </div>}
  </section>;
}
