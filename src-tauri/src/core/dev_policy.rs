//! IPC policy for isolated development and explicit shared-library management.
pub fn command_allowed(command: &str) -> bool {
    allowed_in_mode(command, super::central_repo::manages_existing_library())
}

fn allowed_in_mode(command: &str, management: bool) -> bool {
    if management {
        // Deliberate list: new upstream handlers require review before becoming
        // reachable. Application replacement, relocation and remote backup stay off.
        return matches!(command,
            "git_backup_status"
            | "git_backup_pending_conflicts"
            | "governance_list_scopes"
            | "governance_add_scope"
            | "governance_reparent_scope"
            | "governance_attach_skill"
            | "governance_remove_skill"
            | "governance_effective_skills"
            | "governance_catalog"
            | "usage_status"
            | "usage_summaries"
            | "usage_events"
            | "usage_import_nmem"
            | "usage_import_local"
            | "get_management_mode"
            | "workflow_snapshot"
            | "workflow_set_category"
            | "workflow_refresh"
            | "workflow_recommend"
            | "get_tool_status"
            | "set_tool_enabled"
            | "set_all_tools_enabled"
            | "get_tool_order_cmd"
            | "set_tool_order_cmd"
            | "get_managed_skills"
            | "get_skills_for_preset"
            | "get_skill_document"
            | "get_source_skill_document"
            | "get_skill_source_diff"
            | "delete_managed_skill"
            | "delete_managed_skills"
            | "install_local"
            | "install_git"
            | "preview_git_install"
            | "confirm_git_install"
            | "cancel_git_preview"
            | "install_from_skillssh"
            | "check_skill_update"
            | "check_all_skill_updates"
            | "update_skill"
            | "batch_update_skills"
            | "reimport_local_skill"
            | "relink_local_skill_source"
            | "detach_local_skill_source"
            | "get_all_tags"
            | "set_skill_tags"
            | "rename_tag"
            | "delete_tag"
            | "cancel_install"
            | "batch_import_folder"
            | "sync_skill_to_tool"
            | "unsync_skill_from_tool"
            | "get_skill_tool_toggles"
            | "set_skill_tool_toggle"
            | "scan_local_skills"
            | "import_existing_skill"
            | "import_all_discovered"
            | "fetch_leaderboard"
            | "search_skillssh"
            | "get_settings"
            | "set_settings"
            | "get_central_repo_path"
            | "get_central_repo_path_override"
            | "get_central_repo_pending_path"
            | "get_central_repo_warnings"
            | "open_central_repo_folder"
            | "get_diagnostic_info"
            | "get_recent_log_excerpt"
            | "export_logs_zip"
            | "log_startup_event"
            | "check_last_panic"
            | "clear_last_panic"
            | "app_exit"
            | "restart_app"
            | "hide_to_tray"
            | "get_projects"
            | "add_project"
            | "add_linked_workspace"
            | "remove_project"
            | "reveal_project_folder"
            | "scan_projects"
            | "get_project_agent_targets"
            | "get_project_skills"
            | "get_project_skill_document"
            | "import_project_skill_to_center"
            | "export_skill_to_project"
            | "update_project_skill_to_center"
            | "update_project_skill_from_center"
            | "toggle_project_skill"
            | "delete_project_skill"
            | "slugify_skill_names"
            | "get_global_local_skills"
            | "get_global_local_skill_document"
            | "import_global_local_skill_to_center"
            | "update_global_local_skill_from_center"
            | "delete_global_local_skill"
            | "get_presets"
            | "get_active_preset"
            | "create_preset"
            | "update_preset"
            | "delete_preset"
            | "switch_preset"
            | "apply_preset_to_default"
            | "apply_preset_to_coding_agents"
            | "add_skill_to_preset"
            | "remove_skill_from_preset"
            | "reorder_presets"
            | "reorder_projects"
            | "get_preset_skill_order"
            | "reorder_preset_skills"
        );
    }
    matches!(
        command,
        "get_management_mode"
            | "governance_list_scopes"
            | "governance_add_scope"
            | "governance_reparent_scope"
            | "governance_attach_skill"
            | "governance_remove_skill"
            | "governance_effective_skills"
            | "governance_catalog"
            | "usage_status"
            | "usage_summaries"
            | "usage_events"
            | "usage_import_nmem"
            | "usage_import_local"
            | "workflow_snapshot"
            | "workflow_set_category"
            | "workflow_refresh"
            | "workflow_recommend"
            | "get_managed_skills"
            | "get_skills_for_preset"
            | "get_skill_document"
            | "get_all_tags"
            | "get_tool_status"
            | "get_tool_order_cmd"
            | "get_settings"
            | "get_central_repo_path"
            | "get_central_repo_path_override"
            | "get_central_repo_pending_path"
            | "get_central_repo_warnings"
            | "get_diagnostic_info"
            | "get_recent_log_excerpt"
            | "log_startup_event"
            | "check_last_panic"
            | "clear_last_panic"
            | "app_exit"
            | "hide_to_tray"
            | "get_projects"
            | "get_project_agent_targets"
            | "get_project_skills"
            | "get_project_skill_document"
            | "get_presets"
            | "get_active_preset"
            | "get_preset_skill_order"
            | "get_skill_tool_toggles"
            | "get_global_local_skills"
            | "get_global_local_skill_document"
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn management_opens_existing_handlers_but_not_application_replacement() {
        for c in ["install_local", "delete_managed_skill", "sync_skill_to_tool", "set_skill_tags", "set_settings"] {
            assert!(allowed_in_mode(c, true), "{c}");
            assert!(!allowed_in_mode(c, false), "{c}");
        }
        for c in ["plugin:shell|execute", "git_backup_clone", "set_central_repo_path", "update_install_blocker", "future_unknown", "set_custom_tool_path"] {
            assert!(!allowed_in_mode(c, true), "{c}");
        }
    }
    #[test]
    fn allows_only_reviewed_metadata_writes() {
        for c in [
            "governance_attach_skill",
            "usage_import_nmem",
            "get_managed_skills",
        ] {
            assert!(command_allowed(c));
        }
    }
    #[test]
    fn rejects_production_mutation_and_unknown_commands() {
        for c in [
            "delete_project_skill",
            "export_skill_to_project",
            "install_local",
            "set_settings",
            "set_custom_tool_path",
            "git_backup_clone",
            "set_central_repo_path",
            "update_install_blocker",
            "usage_record_event",
            "governance_unknown",
            "plugin:shell|execute",
        ] {
            assert!(!command_allowed(c), "{c}");
        }
    }
}
