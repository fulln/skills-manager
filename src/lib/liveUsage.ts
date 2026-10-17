import { invoke } from '@tauri-apps/api/core';

export type LiveEvidence = 'explicit_invocation' | 'assistant_declaration' | 'read_inferred';
export const evidenceLabels: Record<LiveEvidence, string> = { explicit_invocation: '明确调用', assistant_declaration: '声明使用', read_inferred: '读取说明' };
export type LiveUsageEvent = { id: string; skill: string; project_path: string | null; agent: string | null; occurred_at: number; session_id: string | null; evidence: LiveEvidence; source_ref: string | null; excerpt: string | null };
export type LiveUsagePoll = { events: LiveUsageEvent[]; checked_at: number; files_scanned: number; coverage_note: string };
export const usageLivePoll = () => invoke<LiveUsagePoll>('usage_live_poll');
