use crate::core::{
    error::AppError,
    usage::{self, ImportResult, NmemImportRequest, UsageEvent, UsageStatus, UsageSummary},
};

#[tauri::command]
pub async fn usage_status() -> Result<UsageStatus, AppError> {
    tauri::async_runtime::spawn_blocking(usage::status)
        .await
        .map_err(AppError::db)?
        .map_err(AppError::db)
}
#[tauri::command]
pub fn usage_summaries(
    skill: Option<String>,
    project: Option<String>,
) -> Result<Vec<UsageSummary>, AppError> {
    usage::summaries(skill.as_deref(), project.as_deref()).map_err(AppError::db)
}
#[tauri::command]
pub fn usage_events(
    skill: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<UsageEvent>, AppError> {
    usage::events(skill.as_deref(), limit.unwrap_or(200)).map_err(AppError::db)
}
#[tauri::command]
pub async fn usage_import_nmem(request: NmemImportRequest) -> Result<ImportResult, AppError> {
    tauri::async_runtime::spawn_blocking(move || usage::import_nmem(request))
        .await
        .map_err(AppError::db)?
        .map_err(AppError::db)
}

#[tauri::command]
pub async fn usage_import_local(
    store: tauri::State<'_, std::sync::Arc<crate::core::skill_store::SkillStore>>,
) -> Result<crate::core::usage_local::LocalImportResult, AppError> {
    let skills = store
        .get_all_skills()
        .map_err(AppError::db)?
        .into_iter()
        .map(|s| s.name)
        .collect();
    tauri::async_runtime::spawn_blocking(move || crate::core::usage_local::import(skills))
        .await
        .map_err(AppError::db)?
        .map_err(AppError::db)
}
