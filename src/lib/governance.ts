import { invoke } from '@tauri-apps/api/core';
export type ScopeKind='global'|'domain'|'project';
export type SkillRole='orchestration'|'specialist'|'primitive';
export interface Scope {id:string;name:string;kind:ScopeKind;project_path:string|null;parent_id:string|null;created_at:number}
export interface ScopeSkill {scope_id:string;skill_id:string;role:SkillRole;excluded:boolean;origin_scope_id:string;inherited:boolean;overridden:boolean}
export interface GovernanceSkill {id:string;name:string;description:string|null}
export const governanceListScopes=()=>invoke<Scope[]>('governance_list_scopes');
export const governanceAddScope=(name:string,kind:ScopeKind,project_path:string|null,parent_id:string|null)=>invoke<Scope>('governance_add_scope',{name,kind,projectPath:project_path,parentId:parent_id});
export const governanceAttachSkill=(scope_id:string,skill_id:string,role:SkillRole,excluded:boolean)=>invoke<void>('governance_attach_skill',{scopeId:scope_id,skillId:skill_id,role,excluded});
export const governanceRemoveSkill=(scope_id:string,skill_id:string)=>invoke<void>('governance_remove_skill',{scopeId:scope_id,skillId:skill_id});
export const governanceEffectiveSkills=(scope_id:string)=>invoke<ScopeSkill[]>('governance_effective_skills',{scopeId:scope_id});
export const governanceCatalog=()=>invoke<GovernanceSkill[]>('governance_catalog');
export const governanceReparentScope = (scopeId: string, parentId: string | null) => invoke<void>('governance_reparent_scope', {scopeId, parentId});
