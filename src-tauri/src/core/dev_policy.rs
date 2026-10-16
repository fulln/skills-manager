//! The first development build exposes governance/analytics writes only.
//! Upstream mutation commands remain compiled, but are unreachable from IPC.
pub fn command_allowed(command: &str) -> bool {
    matches!(
        command,
        "governance_list_scopes"
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
