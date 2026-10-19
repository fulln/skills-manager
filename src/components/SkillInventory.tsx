import { FileSearch, SlidersHorizontal, Trash2 } from 'lucide-react';
import { FrequencyBadge } from './FrequencyBadge';
import type { ManagedSkill } from '../lib/tauri';
import type { SkillFrequency } from '../lib/skillFrequency';
import type { WorkflowSkill } from '../lib/workflow';
import { groupSkillFamilies, type SkillFamily } from '../lib/skillFamily';
import { SkillFamilyCard } from './SkillFamilyCard';

interface Props {
  skills: WorkflowSkill[];
  managed: ManagedSkill[];
  frequencies: Map<string, SkillFrequency>;
  variants: Set<string>;
  ready: boolean;
  availability?: 'loading' | 'unavailable' | 'unmatched';
  days: number;
  view: 'list' | 'cards';
  onInspect: (skill: WorkflowSkill) => void;
  onOpen: (id: string) => void;
  onViewFamily: (family: SkillFamily) => void;
  onUninstall: (skill: WorkflowSkill) => void;
}
const categories = { local_packaged: '本地封装', downloaded: '下载', downloaded_modified: '下载后改动', unknown: '来源待核对' };
const scope = (value: string) => ({ global: '全局', domain: '领域', project: '项目' }[value] || value);
const role = (value: string) => ({ orchestration: '编排', specialist: '专用', primitive: '基础' }[value] || value);
const date = (value: number | null | undefined) => value ? new Date(value * 1000).toLocaleDateString('zh-CN') : '暂无证据';

export function SkillInventory({ skills, managed, frequencies, variants, ready, availability = 'loading', days, view, onInspect, onOpen, onViewFamily, onUninstall }: Props) {
  const frequencyState = ready ? 'ready' : availability;
  const entries = groupSkillFamilies(skills, frequencies);
  const managedById = new Map(managed.map(s => [s.id, s]));
  function metadata(s: WorkflowSkill) {
    const category = s.category_override || s.category || s.detected_category || 'unknown';
    return <><span className={category === 'unknown' ? 'text-secondary' : 'text-primary'}>{categories[category]}</span><span className="block text-[11px] text-tertiary mt-1">{scope(s.scope)} · {role(s.role)}{s.category_override ? ' · 手动' : ''}</span></>;
  }
  function targets(s: WorkflowSkill) {
    const tools = [...new Set(managedById.get(s.id)?.targets.map(t => t.tool) || [])];
    return <span title={tools.join('、')} className="text-[12px] text-secondary">{tools.length ? `${tools.slice(0, 2).join(' / ')}${tools.length > 2 ? ` +${tools.length - 2}` : ''}` : managedById.has(s.id) ? '未配置' : '项目内发现'}</span>;
  }
  function actions(s: WorkflowSkill) {
    return <div className="flex shrink-0 items-center justify-end gap-1">{managedById.has(s.id) && <button className="app-icon-button" title="查看技能内容" aria-label={`查看 ${s.name}`} onClick={() => onOpen(s.id)}><FileSearch size={15} /></button>}<button className="app-icon-button" title="查看来源与配置" aria-label={`配置 ${s.name}`} onClick={() => onInspect(s)}><SlidersHorizontal size={15} /></button><button type="button" aria-label={`卸载 ${s.name}`} title={managedById.has(s.id) || (s.scope === 'project' && s.project_id) ? '卸载这项技能' : '由原插件或 Agent 管理，请在原管理器卸载'} disabled={!managedById.has(s.id) && !(s.scope === 'project' && s.project_id)} className="app-icon-button hover:text-danger disabled:opacity-40 disabled:cursor-not-allowed" onClick={() => onUninstall(s)}><Trash2 size={15} /></button></div>;
  }
  if (view === 'cards') return <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">{entries.map(entry => {
    if (entry.kind === 'family') return <SkillFamilyCard key={entry.family.id} family={entry.family} onView={onViewFamily} days={days} state={frequencyState} view="cards" />;
    const s = entry.skill;
    const f = frequencies.get(s.name);
    return <article key={s.id} className="app-panel p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2"><h3 className="text-[13px] font-semibold break-all">{s.name}</h3>{actions(s)}</div>
      <p className="text-[12px] text-secondary line-clamp-2" title={s.description || ''}>{s.description || '暂无描述'}</p>
      <div className="text-[12px]">{metadata(s)}</div>
      <div className="flex items-center justify-between mt-auto border-t border-border-subtle pt-2"><span className="text-[12px] text-secondary">近 {days} 天明确调用</span><FrequencyBadge count={f?.explicit || 0} days={days} state={frequencyState} large /></div>
      <p className="text-[11px] text-tertiary">声明 {ready ? f?.declared || 0 : '—'} · 读取 {ready ? f?.inferred || 0 : '—'} · {date(f?.lastEvidence)}</p>
      <div className="text-[11px] text-tertiary">Agent 目标：{targets(s)}</div>
      {variants.has(s.name) && <p className="text-[11px] text-tertiary">同名合计，版本待区分</p>}
    </article>;
  })}</div>;
  return <section className="app-panel overflow-x-auto"><table className="w-full table-fixed text-left text-[12px]">
    <caption className="sr-only">技能清单与近 {days} 天使用证据</caption>
    <thead className="bg-bg-secondary text-tertiary"><tr>
      <th className="w-[32%] p-3 font-medium">技能 / 用途</th><th className="w-[14%] p-3 font-medium">来源 / 层级</th><th className="w-[14%] p-3 font-medium">Agent 目标</th>
      <th className="w-[10%] p-3 font-medium text-right">明确调用</th><th className="w-[11%] p-3 font-medium text-right">声明 / 读取</th><th className="w-[12%] p-3 font-medium">最近证据</th><th className="w-[112px] p-3 font-medium text-right">操作</th>
    </tr></thead>
    <tbody>{entries.map(entry => {
      if (entry.kind === 'family') return <SkillFamilyCard key={entry.family.id} family={entry.family} onView={onViewFamily} days={days} state={frequencyState} view="list" />;
      const s = entry.skill;
      const f = frequencies.get(s.name);
      return <tr key={s.id} className="border-t border-border-subtle hover:bg-surface-hover">
        <td className="px-3 py-2.5"><button className="text-[13px] font-medium text-left hover:underline break-all" onClick={() => onInspect(s)}>{s.name}</button><p title={s.description || ''} className="text-[11px] text-tertiary truncate mt-1">{s.description || '暂无描述'}</p></td>
        <td className="p-3">{metadata(s)}</td><td className="p-3">{targets(s)}</td>
        <td className="p-3 text-right"><FrequencyBadge count={f?.explicit || 0} days={days} state={frequencyState} />{variants.has(s.name) && <span className="block text-[11px] text-tertiary" title="按名称合计，无法区分具体副本与版本">同名合计</span>}</td>
        <td className="p-3 text-right tabular-nums text-secondary">{ready ? `${f?.declared || 0} / ${f?.inferred || 0}` : '—'}</td>
        <td className="p-3 text-[11px] text-secondary">{ready ? date(f?.lastEvidence) : '—'}</td><td className="p-2">{actions(s)}</td>
      </tr>;
    })}</tbody>
  </table></section>;
}
