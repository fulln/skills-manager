import type { LiveEvidence, LiveUsageEvent } from './liveUsage';

export type EvidenceCounts = Record<LiveEvidence, number>;
export type UsageNode = { id: string; kind: 'agent' | 'project' | 'skill'; label: string; detail: string; counts: EvidenceCounts; latest: LiveUsageEvent };
export type UsageEdge = { id: string; from: string; to: string; counts: EvidenceCounts };
const counts = (): EvidenceCounts => ({ explicit_invocation: 0, assistant_declaration: 0, read_inferred: 0 });
const agentNames: Record<string, string> = { codex: 'Codex', claude_code: 'Claude Code', pi: 'Pi' };
const key = (...values: (string | null)[]) => JSON.stringify(values);

export function buildLiveGraph(events: LiveUsageEvent[]) {
  const nodes = new Map<string, UsageNode>();
  const edges = new Map<string, UsageEdge>();
  const routes = new Map<string, [string, string, string]>();
  const eventRoutes = new Map<string, [string, string, string]>();
  const projects = new Set<string | null>();
  // Repeated polls must not increase counts for an existing evidence ID.
  for (const event of new Map(events.map(event => [event.id, event])).values()) {
    const agent = key('agent', event.agent);
    // Keep each Agent's project node separate: a shared project must not imply
    // that every Agent used every skill observed in that project.
    const project = key('project', event.agent, event.project_path);
    const skill = key('skill', event.skill);
    const path: [string, string, string] = [agent, project, skill];
    routes.set(key(...path), path); eventRoutes.set(event.id, path); projects.add(event.project_path);
    const addNode = (id: string, kind: UsageNode['kind'], label: string, detail: string) => {
      const node = nodes.get(id) || { id, kind, label, detail, counts: counts(), latest: event };
      node.counts[event.evidence]++;
      if (event.occurred_at > node.latest.occurred_at) node.latest = event;
      nodes.set(id, node);
    };
    addNode(agent, 'agent', event.agent ? agentNames[event.agent] || event.agent : '未知 Agent', event.agent || '日志未提供 Agent');
    addNode(project, 'project', event.project_path?.split('/').filter(Boolean).at(-1) || '未归属项目', event.project_path || '日志未提供项目路径');
    addNode(skill, 'skill', event.skill, '同名技能合计，不能区分副本版本');
    for (const [from, to] of [[agent, project], [project, skill]]) {
      const id = key(from, to); const edge = edges.get(id) || { id, from, to, counts: counts() };
      edge.counts[event.evidence]++; edges.set(id, edge);
    }
  }
  // Evidence arrival order must not shuffle existing nodes on every poll.
  const ordered = [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id));
  return { agents: ordered.filter(n => n.kind === 'agent'), projects: ordered.filter(n => n.kind === 'project'), skills: ordered.filter(n => n.kind === 'skill'), edges: [...edges.values()], eventRoutes, routeCount: routes.size, projectCount: projects.size };
}
