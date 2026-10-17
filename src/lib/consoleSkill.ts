import type { LiveUsageEvent } from './liveUsage';
import type { WorkflowSkill, WorkflowSnapshot } from './workflow';

// The graph merges names; resolve against the evidence's project before globals.
export function consoleSkillCandidates(event: LiveUsageEvent, snapshot: WorkflowSnapshot): WorkflowSkill[] {
  const matches = snapshot.skills.filter(skill => skill.name === event.skill);
  const cwd = event.project_path?.replace(/\/+$/, '');
  const project = cwd ? snapshot.projects.filter(project => cwd === project.path || cwd.startsWith(project.path.replace(/\/+$/, '') + '/')).sort((a, b) => b.path.length - a.path.length)[0] : undefined;
  const local = project ? matches.filter(skill => skill.project_id === project.id) : [];
  const candidates = local.length ? local : matches.filter(skill => !skill.project_id);
  const seen = new Set<string>();
  return candidates.filter(skill => {
    const path = skill.canonical_path || skill.path;
    if (seen.has(path)) return false;
    seen.add(path); return true;
  });
}
