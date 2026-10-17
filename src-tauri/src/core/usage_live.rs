//! Ephemeral read-only views. No transcript text is written to the usage ledger.
use super::{usage::EvidenceKind, usage_local::message_signal};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

#[derive(Debug, Serialize)]
pub struct LiveSkillEvent {
    pub id: String,
    pub skill: String,
    pub project_path: Option<String>,
    pub agent: String,
    pub occurred_at: i64,
    pub session_id: String,
    pub evidence: EvidenceKind,
    pub source_ref: String,
    pub excerpt: String,
}
#[derive(Debug, Serialize)]
pub struct LiveSnapshot {
    pub events: Vec<LiveSkillEvent>,
    pub checked_at: i64,
    pub files_scanned: usize,
    pub coverage_note: String,
}
const HEAD: u64 = 64 * 1024;
const TAIL: u64 = 256 * 1024;
fn files(home: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    let cutoff = SystemTime::now()
        .checked_sub(Duration::from_secs(86400))
        .unwrap_or(SystemTime::UNIX_EPOCH);
    for (root, agent) in [
        (home.join(".codex/sessions"), "codex"),
        (home.join(".codex/archived_sessions"), "codex"),
        (home.join(".claude/projects"), "claude"),
    ] {
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .max_depth(8)
            .into_iter()
            .filter_map(Result::ok)
        {
            if !entry.file_type().is_file()
                || entry.path().extension().and_then(|s| s.to_str()) != Some("jsonl")
            {
                continue;
            }
            if let Ok(meta) = entry.metadata() {
                let modified = meta.modified().unwrap_or(SystemTime::UNIX_EPOCH);
                if modified >= cutoff {
                    out.push((entry.path().to_path_buf(), agent.to_owned(), modified));
                }
            }
        }
    }
    out.sort_by_key(|(_, _, time)| std::cmp::Reverse(*time));
    out.into_iter()
        .take(12)
        .map(|(path, agent, _)| (path, agent))
        .collect()
}
fn timestamp(v: &Value, now: i64) -> Option<i64> {
    v["timestamp"]
        .as_str()
        .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
        .map(|d| d.timestamp())
        .filter(|t| *t >= now - 1800 && *t <= now)
}
fn meta(v: &Value, session: &mut String, project: &mut Option<String>) {
    let p = v.get("payload").unwrap_or(v);
    if v["type"] == "session_meta" {
        if let Some(id) = p["id"].as_str() {
            *session = id.to_owned();
        }
        *project = p["cwd"].as_str().map(str::to_owned);
    }
    if let Some(s) = v["sessionId"].as_str() {
        *session = s.to_owned();
    }
    if project.is_none() {
        *project = v["cwd"].as_str().map(str::to_owned);
    }
}
fn excerpt(v: &Value, skill: &str, kind: &EvidenceKind) -> String {
    match kind {
        EvidenceKind::ReadInferred => {
            return format!("读取 {skill}/SKILL.md（仅说明加载，不代表执行）")
        }
        EvidenceKind::ExplicitInvocation => {
            return format!("显式调用 {skill}（不展示命令参数，不代表执行成功）")
        }
        _ => {}
    }
    let p = v.get("payload").unwrap_or(v);
    let content = p
        .get("message")
        .and_then(|m| m.get("content"))
        .or_else(|| p.get("content"));
    let text = content
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| {
            content
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(|b| b["text"].as_str())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default()
        });
    let pos = text
        .find(skill)
        .map(|byte| text[..byte].chars().count())
        .unwrap_or(0);
    text.chars()
        .skip(pos.saturating_sub(70))
        .take(240)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}
// Only process newline-terminated records: a writer may still be appending the last line.
fn records(bytes: &[u8], start: u64) -> impl Iterator<Item = (u64, &[u8])> {
    let mut offset = start;
    bytes
        .split_inclusive(|b| *b == b'\n')
        .filter_map(move |line| {
            let current = offset;
            offset += line.len() as u64;
            line.ends_with(b"\n").then_some((current, line))
        })
}
fn scan(
    path: &Path,
    agent: &str,
    skills: &[String],
    now: i64,
) -> Result<Vec<LiveSkillEvent>, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    let mut head = Vec::new();
    (&mut file)
        .take(HEAD.min(len))
        .read_to_end(&mut head)
        .map_err(|e| e.to_string())?;
    let mut session = String::new();
    let mut project = None;
    for (_, line) in records(&head, 0) {
        if let Ok(v) = serde_json::from_slice::<Value>(line) {
            meta(&v, &mut session, &mut project);
        }
    }
    let mut start = len.saturating_sub(TAIL);
    file.seek(SeekFrom::Start(start))
        .map_err(|e| e.to_string())?;
    let mut tail = Vec::new();
    (&mut file)
        .take(len - start)
        .read_to_end(&mut tail)
        .map_err(|e| e.to_string())?;
    if start > 0 {
        // The first byte may be inside UTF-8 or JSON. Discard to the next record boundary.
        let skip = tail
            .iter()
            .position(|b| *b == b'\n')
            .map(|i| i + 1)
            .unwrap_or(tail.len());
        tail.drain(..skip);
        start += skip as u64;
    }
    let mut out = Vec::new();
    for (offset, line) in records(&tail, start) {
        let Ok(v) = serde_json::from_slice::<Value>(line) else {
            continue;
        };
        meta(&v, &mut session, &mut project);
        let Some(ts) = timestamp(&v, now) else {
            continue;
        };
        if session.is_empty() {
            continue;
        }
        let text = String::from_utf8_lossy(line);
        for skill in skills {
            if !text.contains(skill) {
                continue;
            }
            if let Some(evidence) = message_signal(&v, skill) {
                out.push(LiveSkillEvent {
                    id: format!("{}#byte={offset}:{skill}", path.display()),
                    skill: skill.clone(),
                    project_path: project.clone(),
                    agent: agent.into(),
                    occurred_at: ts,
                    session_id: session.clone(),
                    excerpt: excerpt(&v, skill, &evidence),
                    evidence,
                    source_ref: format!("{}#byte={offset}", path.display()),
                });
            }
        }
    }
    Ok(out)
}
pub(crate) fn poll_at(home: &Path, skills: Vec<String>, now: i64) -> Result<LiveSnapshot, String> {
    let skills: Vec<_> = skills
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let paths = files(home);
    let mut events = Vec::new();
    let mut failed = 0;
    for (path, agent) in &paths {
        match scan(path, agent, &skills, now) {
            Ok(mut rows) => events.append(&mut rows),
            Err(_) => failed += 1,
        }
    }
    events.sort_by(|a, b| {
        b.occurred_at
            .cmp(&a.occurred_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    events.truncate(100);
    Ok(LiveSnapshot {events, checked_at:now, files_scanned:paths.len(),coverage_note:format!("本地日志最近30分钟；最多12份近24小时活跃文件，每份头64KiB/尾256KiB。超界及未识别格式可能遗漏；{failed}份读取失败。")})
}
pub fn poll(skills: Vec<String>) -> Result<LiveSnapshot, String> {
    poll_at(
        &dirs::home_dir().ok_or("无法确定日志目录")?,
        skills,
        Utc::now().timestamp(),
    )
}

/// Merge existing invocation metadata without copying commands or creating stores.
pub(crate) fn append_bridge(snapshot: &mut LiveSnapshot, root: &Path) -> Result<(), String> {
    use rusqlite::{Connection, OpenFlags};
    use std::collections::HashMap;
    let ledger_path = root.join("library/usage-events.sqlite3");
    if !ledger_path.is_file() {
        return Ok(());
    }
    let c = Connection::open_with_flags(ledger_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| e.to_string())?;
    c.busy_timeout(Duration::from_millis(200))
        .map_err(|e| e.to_string())?;
    let scopes_path = root.join("library/skills-governance.sqlite3");
    let mut scopes = HashMap::new();
    if scopes_path.is_file() {
        let g = Connection::open_with_flags(scopes_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|e| e.to_string())?;
        let mut q = g
            .prepare("SELECT id,project_path FROM scopes WHERE project_path IS NOT NULL")
            .map_err(|e| e.to_string())?;
        for row in q
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
            .map_err(|e| e.to_string())?
        {
            let (id, path) = row.map_err(|e| e.to_string())?;
            scopes.insert(id, path);
        }
    }
    let mut q=c.prepare("SELECT id,skill,project,agent,occurred_at,session_id FROM usage_events WHERE source='workflow' AND evidence='explicit_invocation' AND occurred_at>=?1 AND occurred_at<=?2 ORDER BY occurred_at DESC LIMIT 100").map_err(|e|e.to_string())?;
    let rows = q
        .query_map([snapshot.checked_at - 1800, snapshot.checked_at], |r| {
            let id: String = r.get(0)?;
            let skill: String = r.get(1)?;
            let project: Option<String> = r.get(2)?;
            Ok(LiveSkillEvent {
                id: format!("bridge:{id}"),
                skill: skill.clone(),
                project_path: project.and_then(|p| scopes.get(&p).cloned()),
                agent: r
                    .get::<_, Option<String>>(3)?
                    .unwrap_or_else(|| "bridge".into()),
                occurred_at: r.get(4)?,
                session_id: r.get(5)?,
                evidence: EvidenceKind::ExplicitInvocation,
                source_ref: format!("Dev 调用统计 · {id}"),
                excerpt: format!(
                    "执行桥接记录 {skill} 调用（调用记录不表示成功；不展示命令或结果）"
                ),
            })
        })
        .map_err(|e| e.to_string())?;
    for row in rows {
        snapshot.events.push(row.map_err(|e| e.to_string())?);
    }
    snapshot.events.sort_by(|a, b| {
        b.occurred_at
            .cmp(&a.occurred_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    snapshot.events.truncate(100);
    Ok(())
}

#[cfg(test)]
#[path = "usage_live_tests.rs"]
mod tests;
