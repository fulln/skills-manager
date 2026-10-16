//! Read-only bounded adapters for the local Codex and Claude transcript formats.
use super::{
    governance,
    usage::{self, EvidenceKind, UsageEvent},
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::File,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};
#[derive(Debug, Serialize)]
pub struct LocalImportResult {
    pub scanned_files: usize,
    pub imported: usize,
    pub skipped: usize,
    pub incomplete_files: usize,
    pub malformed_lines: usize,
    pub coverage_note: String,
}
fn message_signal(v: &Value, skill: &str) -> Option<EvidenceKind> {
    let payload = v.get("payload").unwrap_or(v);
    let role = payload["role"]
        .as_str()
        .or_else(|| payload["type"].as_str())
        .unwrap_or("");
    // Code-mode tool inputs contain JavaScript. Extract only JSON string literals;
    // never evaluate source code from a transcript.
    if payload["type"]=="custom_tool_call" && payload["name"]=="exec" {
        let input=payload["input"].as_str().unwrap_or("");
        let literal=regex::Regex::new(r#"(?:cmd|command)\s*:\s*("(?:\\.|[^"\\])*")"#).ok()?;
        for captures in literal.captures_iter(input){
            let command:String=match serde_json::from_str(&captures[1]){Ok(s)=>s,Err(_)=>continue};
            if command.contains(&format!("/{skill}/SKILL.md"))&&command.split_whitespace().any(|word|matches!(word,"cat"|"sed"|"head")){
                return Some(EvidenceKind::ReadInferred);
            }
        }
        return None;
    }
    // Rollout function calls carry raw arguments; this is a read inference, never execution proof.
    if payload["type"] == "function_call" {
        let name = payload["name"].as_str().unwrap_or("");
        let args: Value = payload["arguments"]
            .as_str()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(Value::Null);
        if name == "Skill" && args["skill"].as_str() == Some(skill) {
            return Some(EvidenceKind::ExplicitInvocation);
        }
        if matches!(name, "exec_command" | "shell" | "shell_command") {
            let cmd = args["cmd"]
                .as_str()
                .or_else(|| args["command"].as_str())
                .unwrap_or("");
            if cmd.contains(&format!("/{skill}/SKILL.md"))
                && cmd
                    .split_whitespace()
                    .any(|word| matches!(word, "cat" | "sed" | "head" | "Read"))
            {
                return Some(EvidenceKind::ReadInferred);
            }
        }
        return None;
    }
    let content = payload
        .get("message")
        .and_then(|m| m.get("content"))
        .or_else(|| payload.get("content"));
    let role = payload
        .get("message")
        .and_then(|m| m["role"].as_str())
        .unwrap_or(role);
    if let Some(blocks) = content.and_then(Value::as_array) {
        for b in blocks {
            if b["type"] == "tool_use"
                && b["name"] == "Skill"
                && b["input"]["skill"].as_str() == Some(skill)
            {
                return Some(EvidenceKind::ExplicitInvocation);
            }
        }
    }
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
    if role == "user" && text.split_whitespace().next() == Some(&format!("${skill}")) {
        return Some(EvidenceKind::ExplicitInvocation);
    }
    usage::classify_message(&json!({"role":role,"content":text}), skill)
}
fn import_file(
    connection: &rusqlite::Connection,
    path: &Path,
    source: &str,
    skills: &[String],
    scopes: &[governance::Scope],
    result: &mut LocalImportResult,
) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    const MAX: u64 = 20_000_000;
    if metadata.len() > MAX {
        result.incomplete_files += 1;
        return Ok(());
    }
    let file = File::open(path).map_err(|e| e.to_string())?;
    let lines = BufReader::new(file.take(MAX)).lines();
    let mut session = String::new();
    let mut project = None;
    let mut cwd = None;
    for (index, line) in lines.enumerate() {
        let line = line.map_err(|e| e.to_string())?;
        let v: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => {
                result.malformed_lines += 1;
                continue;
            }
        };
        let p = v.get("payload").unwrap_or(&v);
        if v["type"] == "session_meta" {
            session = p["id"].as_str().unwrap_or("").to_owned();
            cwd = p["cwd"].as_str().map(str::to_owned);
        }
        if let Some(s) = v["sessionId"].as_str() {
            session = s.to_owned();
        }
        if cwd.is_none() {
            cwd = v["cwd"].as_str().map(str::to_owned);
        }
        if session.is_empty() {
            continue;
        }
        if let Some(root) = cwd.as_deref() {
            project = scopes
                .iter()
                .filter_map(|s| {
                    s.project_path
                        .as_deref()
                        .filter(|p| Path::new(root).starts_with(p))
                        .map(|p| (p.len(), s.id.clone()))
                })
                .max_by_key(|x| x.0)
                .map(|x| x.1);
        }
        let Some(ts) = v["timestamp"]
            .as_str()
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.timestamp())
            .filter(|t| *t > 0 && *t <= Utc::now().timestamp())
        else {
            continue;
        };
        for skill in skills {
            if !line.contains(skill) {continue;}
            if let Some(kind) = message_signal(&v, skill) {
                let event = UsageEvent {
                    id: String::new(),
                    skill: skill.clone(),
                    project: project.clone(),
                    agent: Some(source.into()),
                    occurred_at: ts,
                    session_id: Some(session.clone()),
                    evidence: kind,
                    source: source.into(),
                    source_ref: Some(format!("{}#L{}", path.display(), index + 1)),
                    excerpt: Some(format!(
                        "本地 {source} 日志第 {} 行；仅保存来源位置，避免复制完整对话。",
                        index + 1
                    )),
                };
                if usage::insert_at(connection, &event)? {
                    result.imported += 1
                } else {
                    result.skipped += 1
                }
            }
        }
    }
    Ok(())
}
pub fn import(skills: Vec<String>) -> Result<LocalImportResult, String> {
    let home = dirs::home_dir().ok_or("无法确定日志目录")?;
    let roots = [
        (home.join(".codex/sessions"), "codex"),
        (home.join(".codex/archived_sessions"), "codex"),
        (home.join(".claude/projects"), "claude"),
    ];
    let mut paths: Vec<(PathBuf, &str, std::time::SystemTime)> = Vec::new();
    let mut seen = HashSet::new();
    for (root, source) in roots {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .max_depth(8)
            .into_iter()
            .filter_map(std::result::Result::ok)
        {
            if entry.file_type().is_file()
                && entry.path().extension().and_then(|s| s.to_str()) == Some("jsonl")
            {
                let path = entry.path().to_path_buf();
                if seen.insert(path.clone()) {
                    if let Ok(meta) = entry.metadata() {
                        paths.push((
                            path,
                            source,
                            meta.modified().unwrap_or(std::time::UNIX_EPOCH),
                        ));
                    }
                }
            }
        }
    }
    paths.sort_by(|a, b| b.2.cmp(&a.2));
    let mut result=LocalImportResult{scanned_files:0,imported:0,skipped:0,incomplete_files:paths.len().saturating_sub(100),malformed_lines:0,coverage_note:"只读扫描最近修改的最多 100 份 Codex/Claude JSONL；每份最多 20MB。按来源会话与技能去重；读取说明仅计推断。无法覆盖已删除日志、未扫描文件及其他 AI。".into()};
    let scopes = governance::list(
        &governance::open(&super::central_repo::workflow_library_dir().join("skills-governance.sqlite3"))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let connection=usage::open()?;
    connection.execute_batch("BEGIN IMMEDIATE").map_err(|e|e.to_string())?;
    for (path, source, _) in paths.into_iter().take(100) {
        result.scanned_files += 1;
        if import_file(&connection, &path, source, &skills, &scopes, &mut result).is_err() {
            result.incomplete_files += 1;
        }
    }
    connection.execute_batch("COMMIT").map_err(|e|e.to_string())?;
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn code_mode_reads_are_inferred_without_evaluating_javascript(){
        let v=json!({"type":"response_item","payload":{"type":"custom_tool_call","name":"exec","input":"text(await tools.exec_command({cmd:\"cat /tmp/demo/SKILL.md\"}));"}});
        assert_eq!(message_signal(&v,"demo"),Some(EvidenceKind::ReadInferred));
        assert_eq!(message_signal(&v,"other"),None);
    }
    #[test]
    fn catalog_is_never_usage() {
        let v = json!({"type":"response_item","payload":{"type":"message","role":"developer","content":[{"type":"input_text","text":"Available skills: demo"}]}});
        assert!(message_signal(&v, "demo").is_none());
    }
    #[test]
    fn rollout_read_is_inferred() {
        let v = json!({"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"cat /tmp/demo/SKILL.md\"}"}});
        assert_eq!(message_signal(&v, "demo"), Some(EvidenceKind::ReadInferred));
        assert_eq!(message_signal(&v, "other"), None);
    }
    #[test]
    fn claude_tool_invocation() {
        let v = json!({"type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Skill","input":{"skill":"demo"}}]}});
        assert_eq!(
            message_signal(&v, "demo"),
            Some(EvidenceKind::ExplicitInvocation)
        );
    }
    #[test]
    fn user_directive_with_task() {
        let v = json!({"payload":{"role":"user","content":[{"text":"$demo build it"}]}});
        assert_eq!(
            message_signal(&v, "demo"),
            Some(EvidenceKind::ExplicitInvocation)
        );
    }
}
