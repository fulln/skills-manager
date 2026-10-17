import type { UsageSummary } from './usage';
import type { WorkflowSkill } from './workflow';

export interface SkillFrequency {
  explicit: number;
  declared: number;
  inferred: number;
  lastEvidence: number | null;
}

// Compare windows using the same weekly rate; declarations and reads never enter this calculation.
export function frequencyTier(explicit: number | null | undefined, days: number): 'high' | 'low' | 'none' | 'unknown' {
  if (typeof explicit !== 'number' || !Number.isFinite(explicit) || explicit < 0 || !Number.isFinite(days) || days <= 0) return 'unknown';
  if (explicit === 0) return 'none';
  return explicit * 7 >= days ? 'high' : 'low';
}

// Summaries already deduplicate source/session/skill. Only sum one time window.
export function skillFrequencies(rows: UsageSummary[], days: number, project: string | null) {
  const result = new Map<string, SkillFrequency>();
  for (const row of rows) {
    if (row.window_days !== days || (project !== null && row.project !== project)) continue;
    const current = result.get(row.skill) || { explicit: 0, declared: 0, inferred: 0, lastEvidence: null };
    current.explicit += row.explicit;
    current.declared += row.declared;
    current.inferred += row.inferred;
    current.lastEvidence = Math.max(current.lastEvidence || 0, row.last_used_at || 0) || null;
    result.set(row.skill, current);
  }
  return result;
}

export function hasNameVariants(skills: Pick<WorkflowSkill, 'name' | 'path' | 'canonical_path'>[], name: string) {
  return new Set(skills.filter(s => s.name === name).map(s => s.canonical_path || s.path)).size > 1;
}
