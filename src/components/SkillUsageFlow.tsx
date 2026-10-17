import { useMemo } from 'react';
import { Bot, FolderGit2, Sparkles } from 'lucide-react';
import type { LiveUsageEvent } from '../lib/liveUsage';
import { buildLiveGraph, type EvidenceCounts } from '../lib/liveUsageGraph';

const summary = (counts: EvidenceCounts) => `调用 ${counts.explicit_invocation} · 声明 ${counts.assistant_declaration} · 读取 ${counts.read_inferred}`;
const icons = { agent: Bot, project: FolderGit2, skill: Sparkles };

export function SkillUsageFlow({ events, selectedId, onSelect }: { events: LiveUsageEvent[]; selectedId?: string | null; onSelect?: (id: string) => void }) {
  const graph = useMemo(() => buildLiveGraph(events), [events]);
  if (!events.length) return <div className="rounded-lg border border-dashed border-border-subtle px-4 py-5 text-[12px] text-tertiary text-center">等待真实技能事件，收到后展示多个 AI、项目与 Skill 的关联。</div>;
  const columns = [graph.agents, graph.projects, graph.skills];
  const height = Math.max(96, ...columns.map(nodes => nodes.length * 76 + 16));
  const positions = new Map(columns.flatMap((nodes, column) => nodes.map((node, i) => [node.id, { x: [0, 300, 720][column], width: [180, 280, 280][column], y: (i + 0.5) * height / nodes.length }] as const)));
  const selected = new Set(graph.eventRoutes.get(selectedId || '') || []);
  return <div aria-label="多个项目与技能的实时关联图" className="space-y-1">
    <div className="flex items-center justify-between gap-3 text-[11px] text-tertiary"><p>{graph.agents.length} 个 AI · {graph.projectCount} 个项目 · {graph.skills.length} 个技能 · {graph.routeCount} 组关系</p><p>点击节点看片段 · 同名技能合计</p></div>
    <div className="max-h-[480px] overflow-auto rounded-lg border border-border-subtle bg-background p-2">
      <div className="grid min-w-[680px] grid-cols-[18%_12%_28%_14%_28%] text-[11px] text-tertiary"><span>AI</span><span /><span>项目（按 AI 分组）</span><span /><span>Skill</span></div>
      <div className="relative min-w-[680px]" style={{ height }}>
        <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {graph.edges.map(edge => {
            const from = positions.get(edge.from)!; const to = positions.get(edge.to)!;
            const x = from.x + from.width; const mid = (x + to.x) / 2;
            const active = selected.has(edge.from) && selected.has(edge.to);
            return <path key={edge.id} d={`M ${x} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${to.x} ${to.y}`} fill="none" stroke="var(--color-accent)" strokeWidth={active ? 2 : 1.5} opacity={active ? 0.9 : 0.4} strokeDasharray={edge.counts.explicit_invocation ? undefined : '4 4'} />;
          })}
        </svg>
        {columns.flat().map(node => {
          const position = positions.get(node.id)!; const Icon = icons[node.kind]; const active = selected.has(node.id);
          return <button key={node.id} type="button" title={`${node.label}\n${node.detail}\n${summary(node.counts)}`} aria-label={`${node.label}：${summary(node.counts)}`} aria-pressed={active} onClick={() => onSelect?.(node.latest.id)} className={`absolute h-[60px] rounded-lg border px-3 py-2 text-left ${active ? 'border-accent-border bg-accent-bg' : 'border-border-subtle bg-surface hover:bg-surface-hover'}`} style={{ left: `${position.x / 10}%`, width: `${position.width / 10}%`, top: position.y - 30 }}>
            <span className="flex items-center gap-2"><Icon size={14} className="shrink-0 text-secondary" /><strong className="truncate text-[13px] font-medium">{node.label}</strong></span>
            <span className="mt-1 block truncate text-[11px] text-tertiary">{summary(node.counts)}</span>
          </button>;
        })}
      </div>
    </div>
  </div>;
}
