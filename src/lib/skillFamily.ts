import type { SkillFrequency } from './skillFrequency';
import type { WorkflowSkill } from './workflow';

export function specKitFamily(skills: WorkflowSkill[], frequencies: Map<string, SkillFrequency>) {
  const stages = new Map<string, WorkflowSkill[]>();
  const other: WorkflowSkill[] = [];
  for (const skill of skills) {
    if (!/^spec-?kit[.-]/i.test(skill.name)) { other.push(skill); continue; }
    const copies = stages.get(skill.name) || [];
    copies.push(skill);
    stages.set(skill.name, copies);
  }
  const total: SkillFrequency = { explicit: 0, declared: 0, inferred: 0, lastEvidence: null };
  // Evidence is keyed by stage name, not by the number of project copies.
  for (const name of stages.keys()) {
    const f = frequencies.get(name);
    total.explicit += f?.explicit || 0;
    total.declared += f?.declared || 0;
    total.inferred += f?.inferred || 0;
    total.lastEvidence = Math.max(total.lastEvidence || 0, f?.lastEvidence || 0) || null;
  }
  const members = [...stages.values()].flat();
  return { stages, other, total, copies: members.length, projects: new Set(members.map(s => s.project_id).filter(Boolean)).size };
}
