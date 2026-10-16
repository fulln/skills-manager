import { invoke } from '@tauri-apps/api/core';

export type WorkflowSkill = { id: string; name: string; description: string | null; path: string; scope: string; project_id: string | null; role: string };
export type WorkflowProject = { id: string; name: string; path: string; domain: string | null; skill_count: number; effective_skill_ids?: string[] };
export type WorkflowRun = { id: string; project_id: string; project_path: string; task: string; agent: string; status: string; created_at: number; finished_at: number | null; selected_skills: Array<{ id: string; name: string; path: string; reason: string }>; command?: string; exit_code?: number; artifacts?: string[] };
export type WorkflowSnapshot = { projects: WorkflowProject[]; skills: WorkflowSkill[]; runs: WorkflowRun[]; sync: { last_refresh: number | null; running: boolean; error: string | null; project_count: number; skill_count: number; effective_skill_ids?: string[] }; bridge_path: string };
export type WorkflowRecommendation = { run_id: string; project_id: string; candidates: Array<{ id: string; name: string; path: string; reason: string; score: number }>; instructions: string };

export const workflowSnapshot = () => invoke<WorkflowSnapshot>('workflow_snapshot');
export const workflowRefresh = () => invoke<WorkflowSnapshot>('workflow_refresh');
export const workflowRecommend = (projectPath: string, task: string, agent = 'codex') => invoke<WorkflowRecommendation>('workflow_recommend', { projectPath, task, agent });
