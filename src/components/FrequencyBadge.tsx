import { frequencyTier } from '../lib/skillFrequency';

type State = 'ready' | 'loading' | 'unavailable' | 'unmatched';
export function FrequencyBadge({ count, days, state = 'ready', large = false }: { count: number; days: number; state?: State; large?: boolean }) {
  const tier = state === 'ready' ? frequencyTier(count, days) : 'unknown';
  const label = state === 'unavailable' ? '异常' : state === 'unmatched' ? '未匹配' : state === 'loading' ? '待统计' : { high: '高频', low: '低频', none: '暂无记录', unknown: '待统计' }[tier];
  const tone = state === 'unavailable' ? 'error' : tier;
  const description = state === 'unavailable' ? '统计采集异常，不能判断频率' : state !== 'ready' || tier === 'unknown' ? '统计尚未就绪，不能当作零调用' : `近 ${days} 天明确调用证据 ${count} 条；高频阈值 ${Math.ceil(days / 7)} 条（平均每周至少 1 条）。零记录不代表未使用。`;
  return <span className={`usage-frequency usage-frequency-${tone}`} title={description}><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" /><strong className={`${large ? 'text-[17px]' : 'text-[14px]'} tabular-nums`}>{state === 'ready' && tier !== 'unknown' ? count : '—'}</strong><span className="text-[11px] font-medium">{label}</span></span>;
}

export function FrequencyLegend({ days }: { days: number }) {
  return <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tertiary" aria-label="频率颜色说明"><span className="usage-frequency usage-frequency-high">绿 · 高频 ≥{Math.ceil(days / 7)}条</span><span className="usage-frequency usage-frequency-low">黄 · 低频</span><span>灰 · 暂无记录</span><span className="usage-frequency usage-frequency-error">红 · 采集异常</span><span>仅按近 {days} 天明确调用证据；声明和读取另列。</span></p>;
}
