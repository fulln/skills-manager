import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Pause, Play, Trash2 } from 'lucide-react';
import { usageLivePoll } from '../lib/liveUsage';
import type { LiveEvidence } from '../lib/liveUsage';
import { clearLiveUsage, mergeLiveUsage, type LiveUsageBuffer } from '../lib/liveUsageBuffer';

const labels: Record<LiveEvidence, string> = { explicit_invocation: '明确调用', assistant_declaration: '声明使用', read_inferred: '读取说明' };
const date = (ts: number) => new Date(ts * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function SkillConsole() {
  const [open, setOpen] = useState(false); const [paused, setPaused] = useState(false); const [buffer, setBuffer] = useState<LiveUsageBuffer>({ events: [], ignored: new Set() }); const [agent, setAgent] = useState(''); const [project, setProject] = useState(''); const [evidence, setEvidence] = useState<LiveEvidence | ''>(''); const [error, setError] = useState(''); const [checked, setChecked] = useState<number | null>(null); const [coverage, setCoverage] = useState(''); const [scanned, setScanned] = useState<number | null>(null); const running = useRef(false);
  useEffect(() => {
    if (!open || paused) return;
    let cancelled = false;
    let timer: number | undefined;
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      if (!cancelled && !document.hidden) timer = window.setTimeout(() => void poll(), 3000);
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
    void poll(); document.addEventListener('visibilitychange', visibility);
    return () => { cancelled = true; if (timer !== undefined) window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [open, paused]);
  const events = buffer.events;
  const filtered = useMemo(() => events.filter(e => (!agent || e.agent === agent) && (!project || (project === '__none__' ? !e.project_path : e.project_path === project)) && (!evidence || e.evidence === evidence)), [events, agent, project, evidence]);
  const agents = [...new Set([...events.map(e => e.agent).filter(Boolean), ...(agent ? [agent] : [])])] as string[]; const projects = [...new Set([...events.map(e => e.project_path).filter(Boolean), ...(project && project !== '__none__' ? [project] : [])])] as string[];
  return <section className="shrink-0 border-t border-border-subtle bg-bg-secondary" aria-label="技能控制台"><div className="flex items-center justify-between px-4 py-2"><button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex items-center gap-2 text-[13px] font-medium"><ChevronDown size={15} className={open ? 'rotate-180' : ''} />技能控制台 <span className="text-[11px] text-tertiary">{events.length} 条</span></button><div className="flex items-center gap-1">{open && <><button type="button" aria-label={paused ? '继续采集' : '暂停采集'} className="app-icon-button" onClick={() => setPaused(v => !v)}>{paused ? <Play size={14} /> : <Pause size={14} />}</button><button type="button" aria-label="清空显示" className="app-icon-button" onClick={() => setBuffer(prev => clearLiveUsage(prev))}><Trash2 size={14} /></button></>}</div></div>{open && <div className="h-[280px] border-t border-border-subtle p-3 flex flex-col gap-2"><div className="flex flex-wrap gap-2"><select aria-label="Agent筛选" className="app-input text-[11px]" value={agent} onChange={e => setAgent(e.target.value)}><option value="">全部 Agent</option>{agents.map(a => <option key={a}>{a}</option>)}</select><select aria-label="项目筛选" className="app-input text-[11px]" value={project} onChange={e => setProject(e.target.value)}><option value="">全部项目</option><option value="__none__">未归属项目</option>{projects.map(p => <option key={p}>{p}</option>)}</select><select aria-label="证据类型筛选" className="app-input text-[11px]" value={evidence} onChange={e => setEvidence(e.target.value as LiveEvidence | '')}><option value="">全部证据</option>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select><span className="text-[11px] text-tertiary self-center">{paused ? '已暂停' : checked ? `最近检查 ${date(checked)}` : '等待检查'}{scanned !== null ? ` · 扫描 ${scanned} 文件` : ''}</span></div>{coverage && <p className="text-[11px] text-tertiary">{coverage}</p>}{error && <p role="alert" className="text-[11px] text-danger">{error}</p>}{!filtered.length ? <p className="text-[12px] text-tertiary py-6 text-center">{events.length ? '当前筛选没有记录。' : paused ? '已暂停检查。清空显示不会删除统计。' : checked ? '当前没有新的可显示事件；已清空的事件不会重复显示。' : '正在检查已落盘的技能使用证据…'}</p> : <div className="overflow-y-auto min-h-0 space-y-1">{filtered.map(e => <details key={e.id} className="border-b border-border-subtle py-1.5 text-[11px]"><summary className="cursor-pointer"><span className="text-tertiary mr-2">{date(e.occurred_at)}</span><strong className="mr-2">{e.skill}</strong><span className="text-tertiary mr-2">{labels[e.evidence]}</span><span className="text-tertiary">{e.agent || '未知 Agent'} · {e.project_path || '未归属项目'}</span><span className="mt-1 block truncate text-tertiary">{e.excerpt || '未提供片段'}</span></summary><div className="mt-1 pl-3 text-tertiary space-y-1"><p className="break-all">来源：{e.source_ref || '未提供来源位置'}</p></div></details>)}</div>}<p className="text-[11px] text-tertiary">逐段事件与统计去重口径不同；仅显示已落盘日志和桥接，短片段只在内存展示。</p></div>}</section>;
}
