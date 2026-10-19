use crate::core::{error::AppError, workflow};
use serde_json::Value;
use std::path::{Path, PathBuf};
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

#[tauri::command]
pub async fn workflow_set_category(skill_id: String, category: String) -> Result<Value, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        workflow::call(&[
            "set-category",
            "--skill-id",
            &skill_id,
            "--category",
            &category,
        ])
    })
    .await
    .map_err(AppError::db)?
    .map_err(AppError::db)
}

/// Remove one project-local skill discovered by the workflow catalog.
/// The catalog id and path are both required so a stale card cannot delete a
/// different skill with the same name after a refresh.
#[tauri::command]
pub async fn workflow_uninstall_project(
    skill_id: String,
    expected_path: String,
) -> Result<(), AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        if !crate::core::central_repo::manages_existing_library() {
            return Err(AppError::invalid_input("项目技能卸载仅在管理模式开放"));
        }
        let snapshot = workflow::call(&["snapshot"]).map_err(AppError::db)?;
        let expected = uninstall_from_snapshot(&snapshot, &skill_id, &expected_path)?;
        crate::commands::projects::remove_workspace_skill_target(&expected)
    })
    .await
    .map_err(AppError::db)?
}

fn uninstall_from_snapshot(
    snapshot: &Value,
    skill_id: &str,
    expected_path: &str,
) -> Result<PathBuf, AppError> {
    let skill = snapshot["skills"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["id"].as_str() == Some(skill_id))
        })
        .ok_or_else(|| AppError::not_found("技能不在当前目录发现清单中"))?;
    if skill["scope"].as_str() != Some("project") {
        return Err(AppError::invalid_input("只能卸载项目范围技能"));
    }
    let project_id = skill["project_id"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| AppError::invalid_input("技能缺少项目归属"))?;
    let project = snapshot["projects"]
        .as_array()
        .and_then(|items| {
            items
                .iter()
                .find(|item| item["id"].as_str() == Some(project_id))
        })
        .ok_or_else(|| AppError::not_found("项目不在当前目录发现清单中"))?;
    let project_root = PathBuf::from(
        project["path"]
            .as_str()
            .ok_or_else(|| AppError::invalid_input("项目路径无效"))?,
    );
    let expected = PathBuf::from(expected_path);
    if expected
        != PathBuf::from(
            skill["path"]
                .as_str()
                .ok_or_else(|| AppError::invalid_input("技能路径无效"))?,
        )
    {
        return Err(AppError::invalid_input("技能路径已变化，请刷新后重试"));
    }
    validate_project_skill_path(&project_root, &expected)?;
    Ok(expected)
}

fn validate_project_skill_path(project_root: &Path, target: &Path) -> Result<(), AppError> {
    let project_root_abs = if project_root.is_absolute() {
        project_root.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(AppError::io)?
            .join(project_root)
    };
    let target_abs = if target.is_absolute() {
        target.to_path_buf()
    } else {
        std::env::current_dir().map_err(AppError::io)?.join(target)
    };
    let project_root = std::fs::canonicalize(&project_root_abs).map_err(AppError::io)?;
    let relative = target_abs
        .strip_prefix(&project_root_abs)
        .map_err(|_| AppError::invalid_input("技能路径不在项目目录内"))?;
    if relative
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(AppError::invalid_input("技能路径不在项目目录内"));
    }
    if relative.as_os_str().is_empty() {
        return Err(AppError::invalid_input("技能路径不在项目目录内"));
    }
    // Do not follow symlinked ancestors. The final entry itself may be a
    // symlink because remove_target unlinks it without touching its target.
    let mut cursor = project_root.clone();
    let components: Vec<_> = relative.components().collect();
    if components.len() < 3 || !matches!(components.last(), Some(std::path::Component::Normal(_))) {
        return Err(AppError::invalid_input("只能卸载具体技能目录"));
    }
    let allowed = [
        ".agents/skills",
        ".codex/skills",
        ".claude/skills",
        ".gemini/skills",
    ];
    let rel_prefix = components[..components.len() - 1]
        .iter()
        .map(|c| c.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/");
    if !allowed.contains(&rel_prefix.as_str()) {
        return Err(AppError::invalid_input("技能不在受支持的项目技能根目录"));
    }
    for component in &components[..components.len() - 1] {
        cursor.push(component.as_os_str());
        let meta = std::fs::symlink_metadata(&cursor).map_err(AppError::io)?;
        if meta.file_type().is_symlink() || !meta.is_dir() {
            return Err(AppError::invalid_input("技能根目录包含符号链接或不是目录"));
        }
    }
    let final_meta = std::fs::symlink_metadata(&target_abs).map_err(AppError::io)?;
    if !final_meta.is_dir() && !final_meta.file_type().is_symlink() {
        return Err(AppError::invalid_input("技能目标不是目录"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{uninstall_from_snapshot, validate_project_skill_path};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn accepts_project_skill_and_rejects_roots_and_symlink_ancestors() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("project");
        let skills = root.join(".agents/skills");
        fs::create_dir_all(&skills).unwrap();
        let skill = skills.join("demo");
        fs::create_dir(&skill).unwrap();
        assert!(validate_project_skill_path(&root, &skill).is_ok());
        assert!(validate_project_skill_path(&root, &skills).is_err());
        assert!(validate_project_skill_path(&root, &root).is_err());

        let outside = temp.path().join("outside");
        fs::create_dir_all(outside.join("demo")).unwrap();
        let escaped = root.join(".claude");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &escaped).unwrap();
        #[cfg(unix)]
        assert!(validate_project_skill_path(&root, &escaped.join("skills/demo")).is_err());
    }

    #[test]
    fn catalog_id_and_path_select_only_the_requested_project_and_unlink_symlink() {
        let temp = tempdir().unwrap();
        let p1 = temp.path().join("one");
        let p2 = temp.path().join("two");
        let a = p1.join(".agents/skills/same");
        let b = p2.join(".agents/skills/same");
        fs::create_dir_all(&a).unwrap();
        fs::create_dir_all(&b).unwrap();
        let snapshot = serde_json::json!({
            "projects":[{"id":"p1","path":p1},{"id":"p2","path":p2}],
            "skills":[
                {"id":"s1","scope":"project","project_id":"p1","path":a},
                {"id":"s2","scope":"project","project_id":"p2","path":b},
                {"id":"global","scope":"global","path":p1.join(".agents/skills/global")}
            ]
        });
        assert!(uninstall_from_snapshot(&snapshot, "unknown-id", &a.to_string_lossy()).is_err());
        let selected = uninstall_from_snapshot(&snapshot, "s1", &a.to_string_lossy()).unwrap();
        crate::commands::projects::remove_workspace_skill_target(&selected).unwrap();
        assert!(!a.exists() && b.exists());
        assert!(uninstall_from_snapshot(&snapshot, "s1", &b.to_string_lossy()).is_err());
        assert!(uninstall_from_snapshot(&snapshot, "global", &p1.to_string_lossy()).is_err());

        let target = temp.path().join("target");
        fs::create_dir(&target).unwrap();
        let link = p2.join(".agents/skills/link");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&target, &link).unwrap();
        #[cfg(unix)]
        {
            let selected = uninstall_from_snapshot(&serde_json::json!({"projects":[{"id":"p2","path":p2}],"skills":[{"id":"sl","scope":"project","project_id":"p2","path":link}]}), "sl", &link.to_string_lossy()).unwrap();
            crate::commands::projects::remove_workspace_skill_target(&selected).unwrap();
            assert!(!link.exists());
            assert!(target.exists());
        }
    }
}
