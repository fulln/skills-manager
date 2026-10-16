import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Database, RefreshCw, Search } from 'lucide-react';
import { governanceCatalog, governanceListScopes } from '../lib/governance';
import type { GovernanceSkill, Scope } from '../lib/governance';
import { importLocal, importNmem, usageEvents, usageStatus, usageSummaries } from '../lib/usage';
import type { UsageEvent, UsageStatus, UsageSummary } from '../lib/usage';

const labels = { explicit_invocation: '明确调用', assistant_declaration: '声明使用', read_inferred: '读取推断' };
const date = (ts: number | null) => ts ? new Date(ts * 1000).toLocaleString('zh-CN') : '暂无证据';

export function SkillUsage() {
  const [status, setStatus] = useState<UsageStatus | null>(null);
  const [summaries, setSummaries] = useState<UsageSummary[]>([]);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [scopes, setScopes] = useState<Scope[]>([]);
  const [catalog, setCatalog] = useState<GovernanceSkill[]>([]);
  const [project, setProject] = useState('');
  const [days, setDays] = useState(30);
  const [skill, setSkill] = useState('');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestId = useRef(0);
  const reload = useCallback(async () => {
    const id = ++requestId.current;

    try {
      const [s, sums, es, ss, skills] = await Promise.all([
        usageStatus(), usageSummaries(project || null), usageEvents(), governanceListScopes(), governanceCatalog(),
      ]);
      if (id !== requestId.current) return;
      setStatus(s); setSummaries(sums); setEvents(es); setScopes(ss); setCatalog(skills); setError('');
    } catch (e) { if (id === requestId.current) setError(String(e)); }
    finally { if (id === requestId.current) setLoading(false); }
  }, [project]);
  useEffect(() => { void reload(); const timer=window.setInterval(() => void reload(),30000); return () => { window.clearInterval(timer); requestId.current += 1; }; }, [reload]);
  const rows = useMemo(() => summaries.filter(s => s.window_days === days).sort((a, b) => b.events - a.events), [summaries, days]);
  const totals = useMemo(() => rows.reduce((a, r) => ({ explicit: a.explicit + r.explicit, declared: a.declared + r.declared, inferred: a.inferred + r.inferred }), { explicit: 0, declared: 0, inferred: 0 }), [rows]);
  const visibleEvents = events.filter(e => (!project || e.project === project) && e.occurred_at >= Date.now() / 1000 - days * 86400);
  const projectName = (id: string | null) => scopes.find(s => s.id === id)?.name || id || '未归属项目';
  async function collectLocal() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await importLocal();
      await reload();
      setNotice(`扫描 ${result.scanned_files} 份日志，新增 ${result.imported} 条；重复 ${result.skipped} 条，未完整覆盖 ${result.incomplete_files} 份，异常行 ${result.malformed_lines}。${result.coverage_note}`);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  async function collect() {
    if (!skill) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await importNmem(skill, query, project || null);
      await reload();
      if (result.error) setError(result.error);
      setNotice(`找到 ${result.searched_threads} 个候选对话，核对 ${result.shown_threads} 个；新增 ${result.imported} 条，跳过 ${result.skipped} 条。`);
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }
  return <div className="app-page app-page-narrow">
    <div className="app-page-header flex items-start justify-between gap-4">
      <div><h1 className="app-page-title">技能使用统计</h1><p className="app-page-subtitle text-tertiary">按项目追溯使用证据，分别查看明确调用、声明使用与读取推断。</p></div>
      <button className="app-button-secondary" onClick={() => void reload()} disabled={loading || busy}><RefreshCw className="h-4 w-4" />刷新</button>
    </div>
    {error && <div role="alert" className="app-panel p-4 text-[13px] text-red-600 dark:text-red-400">{error}</div>}
    <div className="app-panel p-4 space-y-3">
      <div className="flex items-center gap-2 text-[14px] font-medium"><Database className="h-4 w-4" />数据覆盖 <span className="text-[12px] text-tertiary">{loading ? '正在检查…' : status?.nmem_available ? 'nmem 已连接' : 'nmem 未连接'}</span></div>
      <p className="text-[13px] text-secondary">频率按「技能 × 来源会话」去重，是已采集证据的数量。声明使用不代表执行成功；没有记录不代表没用过。</p>
      <p className="text-[12px] text-tertiary">应用运行时每分钟自动采集近期 Codex／Claude 日志，每十分钟从 nmem 核对最近使用技能的历史。AI 执行桥接实时记录；本页每 30 秒刷新，历史覆盖仍有界。</p>
      <button className="app-button-primary" onClick={() => void collectLocal()} disabled={busy || loading}>{busy ? '正在采集…' : '立即同步本地记录'}</button>
      <div className="flex flex-wrap gap-3">
        <label className="text-[12px] text-secondary flex items-center gap-2">项目<select aria-label="统计项目" className="app-input" value={project} onChange={e => setProject(e.target.value)} disabled={busy}><option value="">全部项目</option>{scopes.filter(s => s.kind === 'project').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="text-[12px] text-secondary flex items-center gap-2">时间<select aria-label="统计时间" className="app-input" value={days} onChange={e => setDays(Number(e.target.value))}>{[7, 30, 90].map(d => <option key={d} value={d}>近 {d} 天</option>)}</select></label>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-3">
      {([['明确调用', totals.explicit], ['声明使用', totals.declared], ['读取推断', totals.inferred]] as const).map(([label, count]) => <div key={label} className="app-panel p-4"><p className="text-[12px] text-secondary">{label}</p><p className="text-[17px] font-semibold mt-2">{count}</p></div>)}
    </div>
    <details className="app-panel p-4 space-y-3">
      <summary className="text-[14px] font-medium cursor-pointer"><Search className="h-4 w-4 inline mr-2" />补充核对 nmem 历史</summary>
      <p className="text-[12px] text-tertiary">沿用 nmem 当前身份和 Space，只读查询。选择项目表示你确认这次导入证据的项目归属。</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="核对技能" className="app-input flex-1 min-w-48" value={skill} onChange={e => setSkill(e.target.value)} disabled={busy}><option value="">选择技能</option>{[...new Set(catalog.map(s => s.name))].sort().map(name => <option key={name} value={name}>{name}</option>)}</select>
        <input aria-label="历史检索词" className="app-input flex-1 min-w-48" value={query} onChange={e => setQuery(e.target.value)} placeholder="可选：原文中的任务关键词" disabled={busy} />
        <button className="app-button-primary" onClick={() => void collect()} disabled={!skill || busy || !status?.nmem_available}>{busy ? '正在核对…' : '检索并导入'}</button>
      </div>
      {notice && <p role="status" className="text-[13px] text-secondary">{notice}</p>}
    </details>
    <section className="app-panel overflow-x-auto">
      <h2 className="text-[14px] font-medium p-4 flex items-center gap-2"><BarChart3 className="h-4 w-4" />近 {days} 天技能频率</h2>
      {loading ? <p className="p-4 text-[13px] text-tertiary">正在读取…</p> : rows.length ? <table className="w-full text-left text-[13px]"><thead className="text-[12px] text-tertiary border-y border-border-subtle"><tr>{['技能', '项目', '证据数', '明确 / 声明 / 推断', '最近证据'].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead><tbody>{rows.map(r => <tr key={`${r.skill}:${r.project}`} className="border-b border-border-subtle"><td className="p-3 break-all">{r.skill}</td><td className="p-3">{projectName(r.project)}</td><td className="p-3">{r.events}</td><td className="p-3">{r.explicit} / {r.declared} / {r.inferred}</td><td className="p-3 whitespace-nowrap text-[12px]">{date(r.last_used_at)}</td></tr>)}</tbody></table> : <p className="p-4 text-[13px] text-tertiary">当前范围还没有使用证据。技能被实际使用后会自动汇入。</p>}
    </section>
    <section className="app-panel p-4 space-y-3"><h2 className="text-[14px] font-medium">原始证据</h2>{visibleEvents.length ? visibleEvents.map(e => <details key={e.id} className="border-t border-border-subtle pt-3"><summary className="cursor-pointer text-[13px]">{e.skill} · {labels[e.evidence]} · {date(e.occurred_at)}</summary><div className="mt-3 space-y-2 text-[12px] text-secondary"><p>项目：{projectName(e.project)} · Agent：{e.agent || '未知'} · 来源：{e.source}</p><p className="break-all">对话：{e.source_ref || e.session_id || '未提供'}</p><p className="whitespace-pre-wrap break-words">{e.excerpt || '未保存片段'}</p></div></details>) : <p className="text-[13px] text-tertiary">当前范围没有可展示的原文片段。</p>}</section>
  </div>;
}
