use crate::core::{error::AppError, workflow};
use serde_json::Value;
#[tauri::command]
pub async fn workflow_snapshot() -> Result<Value, AppError> {
    tauri::async_runtime::spawn_blocking(|| workflow::call(&["snapshot"]))
        .await
        .map_err(AppError::db)?
        .map_err(AppError::db)
}
#[tauri::command]
pub async fn workflow_refresh() -> Result<Value, AppError> {
    tauri::async_runtime::spawn_blocking(|| workflow::call(&["refresh"]))
        .await
        .map_err(AppError::db)?
        .map_err(AppError::db)
}
#[tauri::command]
pub async fn workflow_recommend(
    project_path: String,
    task: String,
    agent: String,
) -> Result<Value, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::call(&[
            "recommend",
            "--project",
            &project_path,
            "--task",
            &task,
            "--agent",
            &agent,
        ])
    })
    .await
    .map_err(AppError::db)?
    .map_err(AppError::db)
}

#[tauri::command]
pub fn get_management_mode() -> bool {
    crate::core::central_repo::manages_existing_library()
}
