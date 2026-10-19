import type { SkillFrequency } from './skillFrequency';
import type { WorkflowSkill } from './workflow';

export interface SkillFamily {
  id: string;
  title: string;
  description: string;
  stages: Map<string, WorkflowSkill[]>;
  total: SkillFrequency;
  copies: number;
  projects: number;
}
export type SkillInventoryEntry = { kind: 'skill'; skill: WorkflowSkill } | { kind: 'family'; family: SkillFamily };

function groupKey(name: string) {
  if (/^(?:spec-?kit[.-]|source-command-speckit[.-])/i.test(name)) return 'suite:speckit';
  if (/^(?:open-?spec[.-]|source-command-opsx-)/i.test(name)) return 'suite:openspec';
  return `skill:${name}`;
}

export function groupSkillFamilies(skills: WorkflowSkill[], frequencies: Map<string, SkillFrequency>): SkillInventoryEntry[] {
  const buckets = new Map<string, WorkflowSkill[]>();
  for (const skill of skills) {
    const key = groupKey(skill.name);
    const bucket = buckets.get(key) || [];
    bucket.push(skill); buckets.set(key, bucket);
  }
  return [...buckets].map(([id, members]) => {
    if (members.length === 1 && id.startsWith('skill:')) return { kind: 'skill', skill: members[0] };
    const stages = new Map<string, WorkflowSkill[]>();
    for (const skill of members) {
      const copies = stages.get(skill.name) || [];
      copies.push(skill); stages.set(skill.name, copies);
    }
    const total: SkillFrequency = { explicit: 0, declared: 0, inferred: 0, lastEvidence: null };
    // Name-based evidence counts once per stage, never once per project copy.
    for (const name of stages.keys()) {
      const f = frequencies.get(name);
      total.explicit += f?.explicit || 0;
      total.declared += f?.declared || 0;
      total.inferred += f?.inferred || 0;
      total.lastEvidence = Math.max(total.lastEvidence || 0, f?.lastEvidence || 0) || null;
    }
    const title = id === 'suite:speckit' ? 'SpecKit' : id === 'suite:openspec' ? 'OpenSpec' : members[0].name;
    const description = id === 'suite:speckit' ? '规范驱动开发：需求、计划、任务、实施与核查。' : id === 'suite:openspec' ? '变更驱动开发：探索、提案、实施与归档。' : members[0].description || '同名技能的项目与版本副本。';
    return { kind: 'family', family: { id, title, description, stages, total, copies: members.length, projects: new Set(members.map(s => s.project_id).filter(Boolean)).size } };
  });
}
