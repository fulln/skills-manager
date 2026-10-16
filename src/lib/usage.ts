import { invoke } from '@tauri-apps/api/core';

export type EvidenceKind = 'explicit_invocation' | 'assistant_declaration' | 'read_inferred';
export interface UsageEvent {
  id: string; skill: string; project: string | null; agent: string | null;
  occurred_at: number; session_id: string | null; evidence: EvidenceKind;
  source: string; source_ref: string | null; excerpt: string | null;
}
export interface UsageSummary {
  skill: string; project: string | null; window_days: number; events: number;
  sessions: number; explicit: number; declared: number; inferred: number;
  last_used_at: number | null;
}
export interface UsageStatus {
  db_path: string; event_count: number; nmem_available: boolean; coverage_note: string;
}
export interface ImportResult {
  searched_threads: number; shown_threads: number; imported: number; skipped: number; error: string | null;
}
export const usageStatus = () => invoke<UsageStatus>('usage_status');
export const usageSummaries = (project: string | null) => invoke<UsageSummary[]>('usage_summaries', { skill: null, project });
export const usageEvents = () => invoke<UsageEvent[]>('usage_events', { skill: null, limit: 200 });
export const importNmem = (skill: string, query: string, project: string | null) => invoke<ImportResult>('usage_import_nmem', {
  request: { skill, query: query || null, project, agent: null, space: null, limit: 5 },
});
export interface LocalImportResult { scanned_files: number; imported: number; skipped: number; incomplete_files: number; malformed_lines: number; coverage_note: string }
export const importLocal = () => invoke<LocalImportResult>('usage_import_local');
