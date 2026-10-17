//! Fixture tests for the live transcript reader. Included by `usage_live`.
#[cfg(test)]
mod tests {
    use crate::core::usage::EvidenceKind;
    use crate::core::usage_live::poll_at;
    use chrono::Utc;
    use serde_json::json;
    use std::fs;
    use std::io::Write;
    use tempfile::tempdir;

    fn fixture() -> (tempfile::TempDir, i64) {
        let d = tempdir().unwrap();
        fs::create_dir_all(d.path().join(".codex/sessions")).unwrap();
        fs::create_dir_all(d.path().join(".claude/projects/p")).unwrap();
        (d, Utc::now().timestamp())
    }
    fn line(v: serde_json::Value) -> String {
        format!("{}\n", v)
    }
    fn meta(id: &str, cwd: &str) -> serde_json::Value {
        json!({"type":"session_meta","payload":{"id":id,"cwd":cwd}})
    }
    fn read(path: &str, skill: &str, ts: i64) -> serde_json::Value {
        json!({"type":"response_item","timestamp":chrono::DateTime::from_timestamp(ts,0).unwrap().to_rfc3339(),"payload":{"type":"function_call","name":"exec_command","arguments":format!(r#"{{"cmd":"cat /tmp/{skill}/SKILL.md"}}"#),"role":"assistant"},"path":path})
    }
    #[test]
    fn unicode_and_head_metadata() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        fs::write(&p, format!("{}{}", line(meta("s","/项目/甲")), line(json!({"timestamp":chrono::DateTime::from_timestamp(now-2,0).unwrap().to_rfc3339(),"payload":{"role":"assistant","content":[{"type":"text","text":format!("{}我将使用 `中文技能` 完成界面验证", "前".repeat(150))}]}})))).unwrap();
        let x = poll_at(d.path(), vec!["中文技能".into()], now).unwrap();
        assert_eq!(x.events.len(), 1);
        assert_eq!(x.events[0].session_id, "s");
        assert_eq!(x.events[0].project_path.as_deref(), Some("/项目/甲"));
    }
    #[test]
    fn claude_array_explicit() {
        let (d, now) = fixture();
        let p = d.path().join(".claude/projects/p/s.jsonl");
        fs::write(&p,format!("{}{}",line(json!({"sessionId":"c","cwd":"/p"})),line(json!({"timestamp":chrono::DateTime::from_timestamp(now-2,0).unwrap().to_rfc3339(),"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Skill","input":{"skill":"demo"}}]}})))).unwrap();
        let x = poll_at(d.path(), vec!["demo".into()], now).unwrap();
        assert_eq!(x.events[0].evidence, EvidenceKind::ExplicitInvocation);
    }
    #[test]
    fn large_tail_keeps_header_metadata() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        let mut s = line(meta("big", "/header"));
        s.push_str(&"x".repeat(300_000));
        s.push('\n');
        s.push_str(&line(read("/tmp/demo", "demo", now - 2)));
        fs::write(&p, s).unwrap();
        let x = poll_at(d.path(), vec!["demo".into()], now).unwrap();
        assert_eq!(x.events[0].session_id, "big");
        assert_eq!(x.events[0].project_path.as_deref(), Some("/header"));
    }
    #[test]
    fn partial_tail_waits_for_newline() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        let s = line(meta("p", "/p"))
            + &serde_json::to_string(&read("/tmp/demo", "demo", now - 2)).unwrap();
        fs::write(&p, s).unwrap();
        assert!(poll_at(d.path(), vec!["demo".into()], now)
            .unwrap()
            .events
            .is_empty());
        fs::OpenOptions::new()
            .append(true)
            .open(&p)
            .unwrap()
            .write_all(b"\n")
            .unwrap();
        assert_eq!(
            poll_at(d.path(), vec!["demo".into()], now)
                .unwrap()
                .events
                .len(),
            1
        );
    }
    #[test]
    fn time_bounds_exclude_old_and_future() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        let old = read("/tmp/a", "a", now - 1801);
        let future = read("/tmp/b", "b", now + 1);
        fs::write(
            &p,
            format!(
                "{}{}{}{}",
                line(meta("s", "/p")),
                line(old),
                line(future),
                line(read("/tmp/now", "now", now - 2))
            ),
        )
        .unwrap();
        let x = poll_at(d.path(), vec!["a".into(), "b".into(), "now".into()], now).unwrap();
        assert_eq!(x.events.len(), 1);
        assert_eq!(x.events[0].skill, "now");
    }
    #[test]
    fn repeated_reads_same_session_are_distinct() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        fs::write(
            &p,
            format!(
                "{}{}{}",
                line(meta("s", "/p")),
                line(read("/tmp/demo", "demo", now - 3)),
                line(read("/tmp/demo", "demo", now - 2))
            ),
        )
        .unwrap();
        assert_eq!(
            poll_at(d.path(), vec!["demo".into()], now)
                .unwrap()
                .events
                .len(),
            2
        );
    }
    #[test]
    fn duplicate_skill_input_does_not_duplicate_events() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        fs::write(
            &p,
            line(meta("s", "/p")) + &line(read("/tmp/demo", "demo", now - 2)),
        )
        .unwrap();
        assert_eq!(
            poll_at(d.path(), vec!["demo".into(), "demo".into()], now)
                .unwrap()
                .events
                .len(),
            1
        );
    }
    #[test]
    fn user_text_and_tool_output_are_not_usage() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        fs::write(&p,format!("{}{}{}",line(meta("s","/p")),line(json!({"timestamp":chrono::DateTime::from_timestamp(now-2,0).unwrap().to_rfc3339(),"payload":{"role":"user","content":"please use demo"}})),line(json!({"timestamp":chrono::DateTime::from_timestamp(now-2,0).unwrap().to_rfc3339(),"payload":{"type":"tool_result","content":"demo"}})))).unwrap();
        assert!(poll_at(d.path(), vec!["demo".into()], now)
            .unwrap()
            .events
            .is_empty());
    }
    #[test]
    fn explicit_user_excerpt_is_safe_and_poll_is_read_only() {
        let (d, now) = fixture();
        let p = d.path().join(".codex/sessions/s.jsonl");
        fs::write(&p,line(meta("s","/p")) + &line(json!({"timestamp":chrono::DateTime::from_timestamp(now-2,0).unwrap().to_rfc3339(),"payload":{"role":"user","content":"$demo secret command"}}))).unwrap();
        let before = fs::read(&p).unwrap();
        let x = poll_at(d.path(), vec!["demo".into()], now).unwrap();
        assert_eq!(before, fs::read(&p).unwrap());
        assert_eq!(x.events.len(), 1);
        assert_eq!(x.events[0].evidence, EvidenceKind::ExplicitInvocation);
        assert!(x.events.iter().all(|e| !e.excerpt.contains("secret")));
    }
}

#[test]
fn bridge_reader_never_creates_a_store() {
    let d = tempfile::tempdir().unwrap();
    let mut snapshot = super::LiveSnapshot {
        events: vec![],
        checked_at: chrono::Utc::now().timestamp(),
        files_scanned: 0,
        coverage_note: String::new(),
    };
    super::append_bridge(&mut snapshot, d.path()).unwrap();
    assert!(std::fs::read_dir(d.path()).unwrap().next().is_none());
}
#[test]
fn bridge_reads_only_invocations_and_discards_stored_excerpts() {
    use rusqlite::Connection;
    let d = tempfile::tempdir().unwrap();
    std::fs::create_dir(d.path().join("library")).unwrap();
    let c = Connection::open(d.path().join("library/usage-events.sqlite3")).unwrap();
    c.execute_batch("CREATE TABLE usage_events(id TEXT,skill TEXT,project TEXT,agent TEXT,occurred_at INTEGER,session_id TEXT,evidence TEXT,source TEXT,excerpt TEXT);").unwrap();
    let now = chrono::Utc::now().timestamp();
    for (id, source, kind) in [
        ("ok", "workflow", "explicit_invocation"),
        ("no", "codex", "read_inferred"),
    ] {
        c.execute("INSERT INTO usage_events VALUES(?1,'demo',NULL,'codex',?2,'session',?3,?4,'private command should not escape')",rusqlite::params![id,now,kind,source]).unwrap();
    }
    let before: i64 = c
        .query_row("SELECT count(*) FROM usage_events", [], |r| r.get(0))
        .unwrap();
    let mut snapshot = super::LiveSnapshot {
        events: vec![],
        checked_at: now,
        files_scanned: 0,
        coverage_note: String::new(),
    };
    super::append_bridge(&mut snapshot, d.path()).unwrap();
    assert_eq!(snapshot.events.len(), 1);
    assert_eq!(snapshot.events[0].id, "bridge:ok");
    assert!(!snapshot.events[0].excerpt.contains("private command"));
    assert_eq!(
        before,
        c.query_row("SELECT count(*) FROM usage_events", [], |r| r
            .get::<_, i64>(0))
            .unwrap()
    );
}
#[test]
#[ignore = "opt-in local diagnostic; reads existing logs and prints only aggregate metadata"]
fn live_probe() {
    use rusqlite::{Connection, OpenFlags};
    let root = std::path::PathBuf::from(
        std::env::var("SKILLS_MANAGER_LIVE_PROBE_ROOT").expect("set explicit Dev root"),
    );
    let c = Connection::open_with_flags(
        root.join("workflow.sqlite3"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let mut q = c.prepare("SELECT DISTINCT name FROM skills").unwrap();
    let skills = q
        .query_map([], |r| r.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    let started = std::time::Instant::now();
    let mut snapshot = super::poll(skills).unwrap();
    super::append_bridge(&mut snapshot, &root).unwrap();
    println!(
        "live files={} events={} elapsed_ms={} explicit={} declared={} read={}",
        snapshot.files_scanned,
        snapshot.events.len(),
        started.elapsed().as_millis(),
        snapshot
            .events
            .iter()
            .filter(|e| matches!(e.evidence, super::EvidenceKind::ExplicitInvocation))
            .count(),
        snapshot
            .events
            .iter()
            .filter(|e| matches!(e.evidence, super::EvidenceKind::AssistantDeclaration))
            .count(),
        snapshot
            .events
            .iter()
            .filter(|e| matches!(e.evidence, super::EvidenceKind::ReadInferred))
            .count()
    );
    assert!(
        !snapshot.events.is_empty(),
        "No observed skill signals in the current bounded window"
    );
}

#[test]
fn claude_declaration_returns_text_not_tool_arguments() {
    let d = tempfile::tempdir().unwrap();
    let path = d.path().join(".claude/projects/a/s.jsonl");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let now = chrono::Utc::now().timestamp();
    let event = serde_json::json!({"sessionId":"claude-session","cwd":"/project","timestamp":chrono::DateTime::from_timestamp(now-1,0).unwrap().to_rfc3339(),"message":{"role":"assistant","content":[{"type":"text","text":"我会使用 `demo` 来检查界面。"},{"type":"tool_use","name":"Other","input":{"secret":"not a transcript excerpt"}}]}});
    std::fs::write(&path, format!("{event}\n")).unwrap();
    let x = super::poll_at(d.path(), vec!["demo".into()], now).unwrap();
    assert_eq!(x.events.len(), 1);
    assert_eq!(
        x.events[0].evidence,
        super::EvidenceKind::AssistantDeclaration
    );
    assert!(x.events[0].excerpt.contains("我会使用 `demo`"));
    assert!(!x.events[0].excerpt.contains("secret"));
    assert_eq!(x.events[0].project_path.as_deref(), Some("/project"));
}
