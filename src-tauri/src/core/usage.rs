//! Usage is evidence, not proof of task success. Imports never modify nmem.
use crate::core::central_repo;
use chrono::{DateTime, Utc};
use regex::Regex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceKind {
    ExplicitInvocation,
    AssistantDeclaration,
    ReadInferred,
}
impl EvidenceKind {
    fn key(&self) -> &'static str {
        match self {
            Self::ExplicitInvocation => "explicit_invocation",
            Self::AssistantDeclaration => "assistant_declaration",
            Self::ReadInferred => "read_inferred",
        }
    }
    fn rank(&self) -> i32 {
        match self {
            Self::ExplicitInvocation => 3,
            Self::AssistantDeclaration => 2,
            Self::ReadInferred => 1,
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEvent {
    pub id: String,
    pub skill: String,
    pub project: Option<String>,
    pub agent: Option<String>,
    pub occurred_at: i64,
    pub session_id: Option<String>,
    pub evidence: EvidenceKind,
    pub source: String,
    pub source_ref: Option<String>,
    pub excerpt: Option<String>,
}
#[derive(Debug, Clone, Serialize)]
pub struct UsageSummary {
    pub skill: String,
    pub project: Option<String>,
    pub window_days: i64,
    pub events: i64,
    pub sessions: i64,
    pub explicit: i64,
    pub declared: i64,
    pub inferred: i64,
    pub last_used_at: Option<i64>,
}
#[derive(Debug, Clone, Serialize)]
pub struct UsageStatus {
    pub db_path: String,
    pub event_count: i64,
    pub nmem_available: bool,
    pub coverage_note: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NmemImportRequest {
    pub skill: String,
    pub project: Option<String>,
    pub agent: Option<String>,
    pub query: Option<String>,
    pub space: Option<String>,
    pub limit: Option<u32>,
}
#[derive(Debug, Clone, Serialize)]
pub struct ImportResult {
    pub searched_threads: usize,
    pub shown_threads: usize,
    pub imported: usize,
    pub skipped: usize,
    pub error: Option<String>,
}
fn db_path() -> PathBuf {
    central_repo::workflow_library_dir().join("usage-events.sqlite3")
}
fn open_at(path: &std::path::Path) -> Result<Connection> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
    }
    let c = Connection::open(path).map_err(|e| e.to_string())?;
    c.busy_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS usage_events(id TEXT PRIMARY KEY,skill TEXT NOT NULL,project TEXT,agent TEXT,occurred_at INTEGER NOT NULL,session_id TEXT NOT NULL,evidence TEXT NOT NULL,source TEXT NOT NULL,source_ref TEXT,excerpt TEXT); CREATE UNIQUE INDEX IF NOT EXISTS usage_identity ON usage_events(source,session_id,skill); CREATE INDEX IF NOT EXISTS usage_time ON usage_events(occurred_at);").map_err(|e|e.to_string())?;
    Ok(c)
}
pub(crate) fn open() -> Result<Connection> {
    open_at(&db_path())
}
fn nmem_binary() -> PathBuf {
    // Finder-launched apps do not inherit the interactive shell's PATH.
    for path in ["/usr/local/bin/nmem", "/opt/homebrew/bin/nmem"] {
        if std::path::Path::new(path).is_file() {
            return path.into();
        }
    }
    PathBuf::from("nmem")
}
pub fn status() -> Result<UsageStatus> {
    let c = open()?;
    let count = c
        .query_row("SELECT count(*) FROM usage_events", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    let available = run_json(&["--json".into(), "status".into()])
        .map(|v| v["status"] == "ok")
        .unwrap_or(false);
    Ok(UsageStatus {
        db_path: db_path().display().to_string(),
        event_count: count,
        nmem_available: available,
        coverage_note:
            "有界采集；按技能与来源会话去重，不代表全量调用次数。声明使用与明确调用分别统计。"
                .into(),
    })
}
fn event_key(e: &UsageEvent) -> String {
    let session = e
        .session_id
        .as_deref()
        .unwrap_or("")
        .strip_prefix("codex-")
        .unwrap_or(e.session_id.as_deref().unwrap_or(""));
    let source = if e.source == "nmem" {
        e.agent.as_deref().unwrap_or("nmem")
    } else {
        &e.source
    };
    let key = serde_json::to_vec(&(source, session, &e.skill)).unwrap_or_default();
    format!("{:x}", Sha256::digest(key))
}
pub(crate) fn insert_at(c: &Connection, e: &UsageEvent) -> Result<bool> {
    if e.skill.trim().is_empty()
        || e.skill.len() > 200
        || e.session_id.as_deref().unwrap_or("").is_empty()
        || e.occurred_at <= 0
        || e.occurred_at > Utc::now().timestamp()
    {
        return Err("事件缺少技能、会话或有效历史时间".into());
    }
    let id = event_key(e);
    let old: Option<(String, Option<String>)> = c
        .query_row(
            "SELECT evidence,project FROM usage_events WHERE id=?1",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((kind, project)) = old {
        if project.is_some() && e.project.is_some() && project != e.project {
            return Err("同一会话与技能已归属其他项目；不能重复导入改变归属".into());
        }
        if project.is_none() && e.project.is_some() {
            c.execute("UPDATE usage_events SET project=?1 WHERE id=?2",params![e.project,id]).map_err(|e|e.to_string())?;
        }
        let rank = match kind.as_str() {
            "explicit_invocation" => 3,
            "assistant_declaration" => 2,
            _ => 1,
        };
        if rank >= e.evidence.rank() {
            c.execute(
                "UPDATE usage_events SET occurred_at=max(occurred_at,?1) WHERE id=?2",
                params![e.occurred_at, id],
            )
            .map_err(|e| e.to_string())?;
            return Ok(false);
        }
        c.execute("UPDATE usage_events SET evidence=?1,occurred_at=?2,excerpt=?3,source_ref=?4 WHERE id=?5",params![e.evidence.key(),e.occurred_at,e.excerpt,e.source_ref,id]).map_err(|e|e.to_string())?;
        return Ok(false);
    }
    c.execute(
        "INSERT INTO usage_events VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            id,
            e.skill,
            e.project,
            e.agent,
            e.occurred_at,
            e.session_id,
            e.evidence.key(),
            e.source,
            e.source_ref,
            e.excerpt
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(true)
}
pub fn insert(e: &UsageEvent) -> Result<bool> {
    insert_at(&open()?, e)
}
fn summaries_at(
    c: &Connection,
    skill: Option<&str>,
    project: Option<&str>,
    now: i64,
) -> Result<Vec<UsageSummary>> {
    let mut out = Vec::new();
    for days in [7i64, 30, 90] {
        let mut s=c.prepare("SELECT skill,project,count(*),count(DISTINCT session_id),sum(evidence='explicit_invocation'),sum(evidence='assistant_declaration'),sum(evidence='read_inferred'),max(occurred_at) FROM usage_events WHERE occurred_at>=?1 AND occurred_at<=?2 AND (?3 IS NULL OR skill=?3) AND (?4 IS NULL OR project=?4) GROUP BY skill,project ORDER BY count(*) DESC,skill").map_err(|e|e.to_string())?;
        let rows = s
            .query_map(params![now - days * 86400, now, skill, project], |r| {
                Ok(UsageSummary {
                    skill: r.get(0)?,
                    project: r.get(1)?,
                    window_days: days,
                    events: r.get(2)?,
                    sessions: r.get(3)?,
                    explicit: r.get(4)?,
                    declared: r.get(5)?,
                    inferred: r.get(6)?,
                    last_used_at: r.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for r in rows {
            out.push(r.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}
pub fn summaries(skill: Option<&str>, project: Option<&str>) -> Result<Vec<UsageSummary>> {
    summaries_at(&open()?, skill, project, Utc::now().timestamp())
}
pub fn events(skill: Option<&str>, limit: u32) -> Result<Vec<UsageEvent>> {
    let c = open()?;
    let mut s=c.prepare("SELECT id,skill,project,agent,occurred_at,session_id,evidence,source,source_ref,excerpt FROM usage_events WHERE (?1 IS NULL OR skill=?1) ORDER BY occurred_at DESC LIMIT ?2").map_err(|e|e.to_string())?;
    let rows = s
        .query_map(params![skill, limit.min(1000)], |r| {
            let k: String = r.get(6)?;
            Ok(UsageEvent {
                id: r.get(0)?,
                skill: r.get(1)?,
                project: r.get(2)?,
                agent: r.get(3)?,
                occurred_at: r.get(4)?,
                session_id: r.get(5)?,
                evidence: match k.as_str() {
                    "explicit_invocation" => EvidenceKind::ExplicitInvocation,
                    "assistant_declaration" => EvidenceKind::AssistantDeclaration,
                    _ => EvidenceKind::ReadInferred,
                },
                source: r.get(7)?,
                source_ref: r.get(8)?,
                excerpt: r.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.map(|r| r.map_err(|e| e.to_string())).collect()
}
fn parse_time(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| {
            v.as_str()
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.timestamp())
        })
        .filter(|t| *t > 0 && *t <= Utc::now().timestamp())
}
fn declaration_pattern(skill: &str) -> String {
    format!(
        r"(?i)(?:我会使用|我将使用|继续使用|本次使用|这次使用|正在使用|已使用|I will use|I'm using|I am using|I'll use|Using)[^\n。；.!?]{{0,60}}[`\s]{}(?:[`\s，。,.]|$)",
        regex::escape(skill)
    )
}
pub(crate) fn classify_message(m: &Value, skill: &str) -> Option<EvidenceKind> {
    let role = m["role"].as_str()?;
    let text = m["content"].as_str().unwrap_or("");
    // Only an actual tool-use object is an explicit invocation, never assistant prose.
    if role == "assistant" {
        if let Some(calls) = m["tool_calls"].as_array() {
            for call in calls {
                let name = call["function"]["name"]
                    .as_str()
                    .or_else(|| call["name"].as_str())
                    .unwrap_or("");
                let args = &call["function"]["arguments"];
                let parsed: Value = if let Some(s) = args.as_str() {
                    serde_json::from_str(s).ok()?
                } else {
                    args.clone()
                };
                if name == "Skill" && parsed["skill"].as_str() == Some(skill) {
                    return Some(EvidenceKind::ExplicitInvocation);
                }
            }
        }
        let re = Regex::new(&declaration_pattern(skill)).ok()?;
        if text
            .lines()
            .any(|line| !line.trim_start().starts_with(['>', '-', '|']) && re.is_match(line))
        {
            return Some(EvidenceKind::AssistantDeclaration);
        }
    }
    if role == "user" && text.trim() == format!("${skill}") {
        return Some(EvidenceKind::ExplicitInvocation);
    }
    None
}
fn parse_thread(detail: &Value, req: &NmemImportRequest) -> Result<Vec<UsageEvent>> {
    let id = detail["id"]
        .as_str()
        .or_else(|| detail["thread_id"].as_str())
        .ok_or("nmem 对话响应缺少 ID")?;
    let messages = detail["messages"]
        .as_array()
        .ok_or("nmem 对话响应缺少 messages")?;
    let mut out = Vec::new();
    for m in messages.iter().take(8) {
        let Some(evidence) = classify_message(m, &req.skill) else {
            continue;
        };
        let Some(ts) = parse_time(&m["timestamp"]) else {
            continue;
        };
        out.push(UsageEvent {
            id: String::new(),
            skill: req.skill.clone(),
            project: req.project.clone(),
            agent: detail["source"].as_str().map(str::to_owned),
            occurred_at: ts,
            session_id: Some(id.into()),
            evidence,
            source: detail["source"].as_str().unwrap_or("nmem").to_owned(),
            source_ref: Some(format!(
                "nowledgemem://thread/{id}#{}",
                m["id"].as_str().unwrap_or("")
            )),
            excerpt: m["content"]
                .as_str()
                .map(|s| s.chars().take(1200).collect()),
        });
    }
    Ok(out)
}
fn run_json(args: &[String]) -> Result<Value> {
    let mut child = Command::new(nmem_binary())
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "找不到 nmem CLI，请安装或检查连接".to_string())?;
    let stdout = child.stdout.take().ok_or("无法读取 nmem 输出")?;
    let stderr = child.stderr.take().ok_or("无法读取 nmem 错误")?;
    let output = thread::spawn(move || {
        let mut b = Vec::new();
        stdout.take(2_000_000).read_to_end(&mut b).map(|_| b)
    });
    let errors = thread::spawn(move || {
        let mut b = Vec::new();
        stderr.take(16_000).read_to_end(&mut b).map(|_| b)
    });
    let started = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(s) => break s,
            None if started.elapsed() > Duration::from_secs(20) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("nmem 查询超时，未继续读取其他对话".into());
            }
            None => thread::sleep(Duration::from_millis(30)),
        }
    };
    let bytes = output
        .join()
        .map_err(|_| "nmem 输出线程失败")?
        .map_err(|e| e.to_string())?;
    let _ = errors.join();
    if !status.success() {
        return Err(format!(
            "nmem 查询失败（退出码 {:?}），请用 nmem doctor 检查当前身份和连接",
            status.code()
        ));
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("nmem 返回无效 JSON：{e}"))
}
pub fn import_nmem(req: NmemImportRequest) -> Result<ImportResult> {
    if req.skill.trim().is_empty() || req.skill.len() > 200 {
        return Err("请选择有效技能".into());
    }
    if req.space.is_some() {
        return Err("当前连接沿用 nmem 配置的身份和 Space，不支持在此覆盖范围".into());
    }
    // KFS reports exact message line offsets; the CLI's t search projection does not.
    let capabilities = run_json(&["--json".into(), "fs".into(), "capabilities".into()])?;
    if !capabilities.is_object() {
        return Err("当前 nmem 不支持知识文件检索".into());
    }
    let limit = req.limit.unwrap_or(5).clamp(1, 20);
    let regex = declaration_pattern(&req.skill);
    let found = run_json(&[
        "--json".into(),
        "fs".into(),
        "grep".into(),
        "--regex".into(),
        regex,
        "/threads".into(),
        "--limit".into(),
        limit.to_string(),
    ])?;
    let matches = found["matches"]
        .as_array()
        .ok_or("nmem 检索响应缺少 matches")?;
    let mut ids = std::collections::HashSet::new();
    for m in matches {
        if let Some(id) = m["thread_id"].as_str() {
            ids.insert(id);
        }
    }
    let query = req.query.as_deref().unwrap_or("").trim().to_lowercase();
    let selected = matches.iter().find(|m| {
        query.is_empty()
            || m["match"]
                .as_str()
                .unwrap_or("")
                .to_lowercase()
                .contains(&query)
    });
    let Some(selected) = selected else {
        return Ok(ImportResult {
            searched_threads: ids.len(),
            shown_threads: 0,
            imported: 0,
            skipped: matches.len(),
            error: None,
        });
    };
    let id = selected["thread_id"]
        .as_str()
        .ok_or("匹配记录缺少对话 ID")?;
    let offset = selected["line"].as_u64().unwrap_or(1).saturating_sub(1);
    let detail = run_json(&[
        "--json".into(),
        "threads".into(),
        "show".into(),
        id.into(),
        "--limit".into(),
        "8".into(),
        "--offset".into(),
        offset.to_string(),
        "--content-limit".into(),
        "1200".into(),
    ])?;
    let parsed = parse_thread(&detail, &req)?;
    let c = open()?;
    let mut imported = 0;
    let mut skipped = 0;
    for e in parsed {
        if insert_at(&c, &e)? {
            imported += 1
        } else {
            skipped += 1
        }
    }
    Ok(ImportResult {
        searched_threads: ids.len(),
        shown_threads: 1,
        imported,
        skipped,
        error: None,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn event(skill: &str) -> UsageEvent {
        UsageEvent {
            id: "ignored-client-id".into(),
            skill: skill.into(),
            project: None,
            agent: None,
            occurred_at: Utc::now().timestamp() - 3600,
            session_id: Some("session".into()),
            evidence: EvidenceKind::AssistantDeclaration,
            source: "nmem".into(),
            source_ref: None,
            excerpt: None,
        }
    }
    fn message(role: &str, text: &str) -> Value {
        json!({"role":role,"content":text,"timestamp":"2026-01-01T00:00:00Z"})
    }
    #[test]
    fn declares_actual_skill_only() {
        assert_eq!(
            classify_message(
                &message("assistant", "我会使用已安装的 `demo` skill。"),
                "demo"
            ),
            Some(EvidenceKind::AssistantDeclaration)
        );
        assert_eq!(
            classify_message(&message("assistant", "继续使用 `demo` skill"), "demo"),
            Some(EvidenceKind::AssistantDeclaration)
        );
        assert_eq!(
            classify_message(&message("assistant", "我会使用 `demo-long` skill"), "demo"),
            None
        );
    }
    #[test]
    fn excludes_catalog_install_and_mentions() {
        for text in [
            "已安装 demo，下次可以调用。",
            "demo 很适合这个任务",
            "读取 demo/SKILL.md",
            "- demo: 我会使用 demo",
            "> 我会使用 `demo` skill",
            "本次调用 demo 成功",
        ] {
            assert_eq!(
                classify_message(&message("assistant", text), "demo"),
                None,
                "{text}"
            );
        }
        assert_eq!(
            classify_message(&message("developer", "我会使用 `demo` skill"), "demo"),
            None
        );
    }
    #[test]
    fn prose_call_is_not_explicit() {
        assert_eq!(
            classify_message(&message("assistant", "我会使用 `demo`，并调用它"), "demo"),
            Some(EvidenceKind::AssistantDeclaration)
        );
        assert_eq!(
            classify_message(&message("user", "$demo"), "demo"),
            Some(EvidenceKind::ExplicitInvocation)
        );
    }
    #[test]
    fn actual_tool_call_is_explicit() {
        let v = json!({"role":"assistant","tool_calls":[{"function":{"name":"Skill","arguments":"{\"skill\":\"demo\"}"}}]});
        assert_eq!(
            classify_message(&v, "demo"),
            Some(EvidenceKind::ExplicitInvocation)
        );
    }
    #[test]
    fn rejects_missing_future_times() {
        assert!(parse_time(&Value::Null).is_none());
        assert!(parse_time(&json!(Utc::now().timestamp() + 100)).is_none());
        assert!(parse_time(&json!(0)).is_none());
    }
    #[test]
    fn repeat_session_dedup_and_separate_skills() {
        let d = tempfile::tempdir().unwrap();
        let c = open_at(&d.path().join("usage.db")).unwrap();
        let e = event("demo");
        assert!(insert_at(&c, &e).unwrap());
        assert!(!insert_at(&c, &e).unwrap());
        assert!(insert_at(&c, &event("other")).unwrap());
        assert_eq!(
            c.query_row("SELECT count(*) FROM usage_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }
    #[test]
    fn stronger_evidence_upgrades_without_extra_count() {
        let d = tempfile::tempdir().unwrap();
        let c = open_at(&d.path().join("usage.db")).unwrap();
        let mut e = event("demo");
        insert_at(&c, &e).unwrap();
        e.evidence = EvidenceKind::ExplicitInvocation;
        assert!(!insert_at(&c, &e).unwrap());
        let rows = summaries_at(&c, None, None, Utc::now().timestamp()).unwrap();
        assert!(rows
            .iter()
            .all(|r| r.events == 1 && r.explicit == 1 && r.declared == 0));
    }
    #[test]
    fn project_conflict_is_not_double_counted() {
        let d = tempfile::tempdir().unwrap();
        let c = open_at(&d.path().join("usage.db")).unwrap();
        let mut e = event("demo");
        e.project = Some("first-project".into());
        insert_at(&c, &e).unwrap();
        e.project = Some("other-project".into());
        assert!(insert_at(&c, &e).is_err());
    }
    #[test]
    fn project_assignment_can_enrich_unassigned_event_without_extra_count(){
        let d=tempfile::tempdir().unwrap();let c=open_at(&d.path().join("usage.db")).unwrap();
        let mut e=event("demo");insert_at(&c,&e).unwrap();e.project=Some("p".into());
        assert!(!insert_at(&c,&e).unwrap());
        assert_eq!(summaries_at(&c,None,Some("p"),Utc::now().timestamp()).unwrap()[0].events,1);
        e.project=None;assert!(!insert_at(&c,&e).unwrap());
        assert_eq!(summaries_at(&c,None,Some("p"),Utc::now().timestamp()).unwrap()[0].events,1);
    }
    #[test]
    fn windows_and_project_filters() {
        let d = tempfile::tempdir().unwrap();
        let c = open_at(&d.path().join("usage.db")).unwrap();
        let now = Utc::now().timestamp();
        let mut e = event("demo");
        e.occurred_at = now - 8 * 86400;
        e.project = Some("p".into());
        insert_at(&c, &e).unwrap();
        let rows = summaries_at(&c, None, Some("p"), now).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].window_days, 30);
        assert!(summaries_at(&c, None, Some("other"), now)
            .unwrap()
            .is_empty());
    }
    #[test]
    fn cli_fixture_shape_and_timestamp() {
        let req = NmemImportRequest {
            skill: "demo".into(),
            project: None,
            agent: None,
            query: None,
            space: None,
            limit: None,
        };
        let detail = json!({"id":"codex-thread","source":"codex","messages":[message("assistant","我会使用 `demo` skill"),message("developer","我会使用 `demo` skill")]});
        let es = parse_thread(&detail, &req).unwrap();
        assert_eq!(es.len(), 1);
        assert_eq!(es[0].occurred_at, 1767225600);
        assert_eq!(es[0].agent.as_deref(), Some("codex"));
    }
    #[test]
    fn regex_escapes_skill_input() {
        let p = declaration_pattern("demo.*;$(bad)");
        assert!(Regex::new(&p)
            .unwrap()
            .is_match("我会使用 `demo.*;$(bad)` skill"));
        assert!(!Regex::new(&p).unwrap().is_match("我会使用 `demoXYZ` skill"));
    }
    #[test]
    #[ignore = "requires local nmem and a real saved thread; explicit bounded smoke"]
    fn live_nmem_import() {
        let _guard = central_repo::test_base_dir_lock();
        let d = tempfile::tempdir().unwrap();
        central_repo::set_test_base_dir_override(Some(d.path().into()));
        let req = NmemImportRequest {
            skill: "lanshu-create-ai-presenter-video".into(),
            project: None,
            agent: None,
            query: None,
            space: None,
            limit: Some(5),
        };
        let result = import_nmem(req);
        central_repo::set_test_base_dir_override(None);
        let result = result.unwrap();
        assert_eq!(result.shown_threads, 1);
        assert_eq!(result.imported, 1);
    }
}
