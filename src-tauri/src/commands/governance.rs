use crate::core::{central_repo, error::AppError, governance, skill_store::SkillStore};
use std::sync::Arc;
use tauri::State;

fn db() -> Result<rusqlite::Connection, AppError> {
    governance::open(&central_repo::base_dir().join("skills-governance.sqlite3"))
        .map_err(AppError::db)
}

#[tauri::command]
pub fn governance_list_scopes() -> Result<Vec<governance::Scope>, AppError> {
    governance::list(&db()?).map_err(AppError::db)
}

#[tauri::command]
pub fn governance_add_scope(
    name: String,
    kind: String,
    project_path: Option<String>,
    parent_id: Option<String>,
) -> Result<governance::Scope, AppError> {
    governance::add(
        &db()?,
        &name,
        &kind,
        project_path.as_deref(),
        parent_id.as_deref(),
    )
    .map_err(AppError::db)
}

#[tauri::command]
pub fn governance_attach_skill(
    scope_id: String,
    skill_id: String,
    role: String,
    excluded: bool,
    store: State<'_, Arc<SkillStore>>,
) -> Result<(), AppError> {
    if store
        .get_skill_by_id(&skill_id)
        .map_err(AppError::db)?
        .is_none()
    {
        return Err(AppError::db(anyhow::anyhow!("skill not found")));
    }
    governance::attach(&db()?, &scope_id, &skill_id, &role, excluded).map_err(AppError::db)
}

#[tauri::command]
pub fn governance_remove_skill(scope_id: String, skill_id: String) -> Result<(), AppError> {
    governance::remove(&db()?, &scope_id, &skill_id).map_err(AppError::db)
}
#[tauri::command]
pub fn governance_reparent_scope(
    scope_id: String,
    parent_id: Option<String>,
) -> Result<(), AppError> {
    governance::reparent(&db()?, &scope_id, parent_id.as_deref()).map_err(AppError::db)
}

#[tauri::command]
pub fn governance_effective_skills(
    scope_id: String,
) -> Result<Vec<governance::ScopeSkill>, AppError> {
    governance::effective(&db()?, &scope_id).map_err(AppError::db)
}

#[tauri::command]
pub fn governance_catalog(
    store: State<'_, Arc<SkillStore>>,
) -> Result<Vec<crate::core::skill_store::SkillRecord>, AppError> {
    store.get_all_skills().map_err(AppError::db)
}
