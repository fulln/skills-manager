import type { ManagedSkill } from './tauri';
import type { Scope } from './governance';
import type { UsageSummary } from './usage';
import type { WorkflowSnapshot } from './workflow';

export interface SkillProjectLink {
  path: string;
  name: string;
  local: boolean;
  sameName: boolean;
  explicit: number;
  declared: number;
  inferred: number;
}

// Availability inherited from a global skill is not evidence of a project relationship.
export function skillProjectLinks(
  skill: Pick<ManagedSkill, 'id' | 'name' | 'central_path'>,
  snapshot: WorkflowSnapshot,
  scopes: Scope[],
  summaries: UsageSummary[],
): SkillProjectLink[] {
  const links = new Map<string, SkillProjectLink>();
  const ensure = (path: string, name: string) => {
    let link = links.get(path);
    if (!link) {
      link = { path, name, local: false, sameName: false, explicit: 0, declared: 0, inferred: 0 };
      links.set(path, link);
    }
    return link;
  };
  for (const copy of snapshot.skills) {
    if (copy.name !== skill.name || !copy.project_id) continue;
    const project = snapshot.projects.find(p => p.id === copy.project_id);
    if (!project) continue;
    const link = ensure(project.path, project.name);
    if (copy.id === skill.id || (copy.canonical_path || copy.path) === skill.central_path) link.local = true;
    else link.sameName = true;
  }
  for (const row of summaries) {
    if (row.skill !== skill.name || row.window_days !== 30 || !row.project || row.events <= 0) continue;
    const scope = scopes.find(s => s.id === row.project && s.kind === 'project');
    const project = snapshot.projects.find(p => p.id === row.project || p.path === row.project || p.path === scope?.project_path);
    const path = project?.path || scope?.project_path || (row.project.startsWith('/') ? row.project : null);
    if (!path) continue;
    const link = ensure(path, project?.name || scope?.name || path.split('/').filter(Boolean).pop() || path);
    link.explicit += row.explicit;
    link.declared += row.declared;
    link.inferred += row.inferred;
  }
  return [...links.values()].sort((a, b) => b.explicit - a.explicit || Number(b.local) - Number(a.local) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
