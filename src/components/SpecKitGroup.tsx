import { FrequencyBadge } from './FrequencyBadge';
import type { specKitFamily } from '../lib/skillFamily';

interface Props {
  family: ReturnType<typeof specKitFamily>;
  days: number;
  state: 'ready' | 'loading' | 'unavailable' | 'unmatched';
  view: 'list' | 'cards';
}

export function SpecKitGroup({ family, days, state, view }: Props) {
  const ready = state === 'ready';
  const count = `${family.stages.size} 个阶段 · ${family.projects} 个项目 · ${family.copies} 个副本`;
  const description = '规范驱动开发：需求、计划、任务、实施与核查。';
  const categories = [...new Set([...family.stages.values()].flat().map(s => s.category_override || s.category || s.detected_category || 'unknown'))];
  const source = categories.length === 1 ? ({ local_packaged: '本地封装', downloaded: '下载', downloaded_modified: '下载后改动', unknown: '来源待核对' }[categories[0]]) : '多种来源';
  const last = family.total.lastEvidence ? new Date(family.total.lastEvidence * 1000).toLocaleDateString('zh-CN') : '暂无证据';
  if (view === 'list') return <tr aria-label="SpecKit 技能组" className="border-t border-border-subtle hover:bg-surface-hover">
    <td className="px-3 py-2.5"><span className="text-[13px] font-medium">SpecKit</span><p className="text-[11px] text-tertiary mt-1">{count}</p></td>
    <td className="p-3"><span>{source}</span><span className="block text-[11px] text-tertiary mt-1">项目 · 技能组</span></td>
    <td className="p-3 text-secondary">项目内发现</td>
    <td className="p-3 text-right"><FrequencyBadge count={family.total.explicit} days={days} state={state} /></td>
    <td className="p-3 text-right tabular-nums text-secondary">{ready ? `${family.total.declared} / ${family.total.inferred}` : '—'}</td>
    <td className="p-3 text-[11px] text-secondary">{ready ? last : '—'}</td><td className="p-2 text-right text-tertiary">仅展示</td>
  </tr>;
  return <article aria-label="SpecKit 技能组" className="app-panel p-3 flex flex-col gap-2">
    <div className="min-h-7 flex items-start justify-between gap-2"><h3 className="text-[13px] font-semibold">SpecKit</h3></div>
    <p className="text-[12px] text-secondary line-clamp-2" title={description}>{description}</p>
    <div className="text-[12px]"><span className={source === '来源待核对' ? 'text-secondary' : 'text-primary'}>{source}</span><span className="block text-[11px] text-tertiary mt-1">{count}</span></div>
    <div className="flex items-center justify-between mt-auto border-t border-border-subtle pt-2"><span className="text-[12px] text-secondary">近 {days} 天明确调用</span><FrequencyBadge count={family.total.explicit} days={days} state={state} large /></div>
    <p className="text-[11px] text-tertiary">声明 {ready ? family.total.declared : '—'} · 读取 {ready ? family.total.inferred : '—'} · {ready ? last : '—'}</p>
    <div className="text-[11px] text-tertiary">Agent 目标：项目内发现 · 按阶段名称合计</div>
  </article>;
}
