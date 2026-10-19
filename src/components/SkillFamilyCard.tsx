import { FileSearch, Trash2 } from 'lucide-react';
import { FrequencyBadge } from './FrequencyBadge';
import type { SkillFamily } from '../lib/skillFamily';

interface Props {
  family: SkillFamily;
  onView: (family: SkillFamily) => void;
  days: number;
  state: 'ready' | 'loading' | 'unavailable' | 'unmatched';
  view: 'list' | 'cards';
}

export function SkillFamilyCard({ family, onView, days, state, view }: Props) {
  const ready = state === 'ready';
  const count = `${family.stages.size} ${family.id.startsWith('suite:') ? '个阶段' : '种技能'} · ${family.projects ? `${family.projects} 个项目 · ` : ''}${family.copies} 个副本`;
  const members = [...family.stages.values()].flat();
  const scopes = [...new Set(members.map(s => s.scope))];
  const scope = scopes.length === 1 ? ({ global: '全局', domain: '领域', project: '项目' }[scopes[0]] || scopes[0]) : '多种范围';
  const targets = members.every(s => !!s.project_id) ? '项目内发现' : '沿用各副本配置';
  const description = family.description;
  const action = <div className="flex shrink-0 items-center gap-1"><button className="app-icon-button" title="查看技能组" aria-label={`查看 ${family.title} 技能组`} onClick={() => onView(family)}><FileSearch size={15} /></button><button type="button" aria-label={`选择卸载 ${family.title} 中的技能`} title="选择具体技能卸载" className="app-icon-button hover:text-danger" onClick={() => onView(family)}><Trash2 size={15} /></button></div>;
  const categories = [...new Set(members.map(s => s.category_override || s.category || s.detected_category || 'unknown'))];
  const source = categories.length === 1 ? ({ local_packaged: '本地封装', downloaded: '下载', downloaded_modified: '下载后改动', unknown: '来源待核对' }[categories[0]]) : '多种来源';
  const last = family.total.lastEvidence ? new Date(family.total.lastEvidence * 1000).toLocaleDateString('zh-CN') : '暂无证据';
  if (view === 'list') return <tr aria-label={`${family.title} 技能组`} className="border-t border-border-subtle hover:bg-surface-hover">
    <td className="px-3 py-2.5"><span className="text-[13px] font-medium">{family.title}</span><p className="text-[11px] text-tertiary mt-1">{count}</p></td>
    <td className="p-3"><span>{source}</span><span className="block text-[11px] text-tertiary mt-1">{scope} · 技能组</span></td>
    <td className="p-3 text-secondary">{targets}</td>
    <td className="p-3 text-right"><FrequencyBadge count={family.total.explicit} days={days} state={state} /></td>
    <td className="p-3 text-right tabular-nums text-secondary">{ready ? `${family.total.declared} / ${family.total.inferred}` : '—'}</td>
    <td className="p-3 text-[11px] text-secondary">{ready ? last : '—'}</td><td className="p-2 text-right">{action}</td>
  </tr>;
  return <article aria-label={`${family.title} 技能组`} className="app-panel p-3 flex flex-col gap-2">
    <div className="min-h-7 flex items-start justify-between gap-2"><h3 className="text-[13px] font-semibold"><button className="text-left hover:underline" onClick={() => onView(family)}>{family.title}</button></h3>{action}</div>
    <p className="text-[12px] text-secondary line-clamp-2" title={description}>{description}</p>
    <div className="text-[12px]"><span className={source === '来源待核对' ? 'text-secondary' : 'text-primary'}>{source}</span><span className="block text-[11px] text-tertiary mt-1">{count}</span></div>
    <div className="flex items-center justify-between mt-auto border-t border-border-subtle pt-2"><span className="text-[12px] text-secondary">近 {days} 天明确调用</span><FrequencyBadge count={family.total.explicit} days={days} state={state} large /></div>
    <p className="text-[11px] text-tertiary">声明 {ready ? family.total.declared : '—'} · 读取 {ready ? family.total.inferred : '—'} · {ready ? last : '—'}</p>
    <div className="text-[11px] text-tertiary">Agent 目标：{targets} · 按技能名称合计</div>
  </article>;
}
