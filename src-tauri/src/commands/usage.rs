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
pub async fn usage_import_local() -> Result<crate::core::usage_local::LocalImportResult, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        let skills = crate::core::workflow::names().map_err(|e| e.to_string())?;
        crate::core::usage_local::import(skills)
    })
    .await
    .map_err(AppError::db)?
    .map_err(AppError::db)
}

/// Local-only ephemeral console; all SQLite handles are strictly read-only.
#[tauri::command]
pub async fn usage_live_poll() -> Result<crate::core::usage_live::LiveSnapshot, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        use rusqlite::{Connection, OpenFlags};
        let root = crate::core::central_repo::dev_root();
        let catalog = Connection::open_with_flags(
            root.join("workflow.sqlite3"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .map_err(|e| e.to_string())?;
        let mut query = catalog
            .prepare("SELECT DISTINCT name FROM skills WHERE name IS NOT NULL")
            .map_err(|e| e.to_string())?;
        let skills = query
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        let mut snapshot = crate::core::usage_live::poll(skills)?;
        if crate::core::usage_live::append_bridge(&mut snapshot, &root).is_err() {
            snapshot
                .coverage_note
                .push_str(" 桥接记录暂不可读，当前只显示本地日志。");
        }
        Ok::<_, String>(snapshot)
    })
    .await
    .map_err(AppError::db)?
    .map_err(AppError::db)
}
