//! App and AI callers share one live catalog and isolated ledger.
use anyhow::{bail, Result};
use serde_json::Value;
use std::{
    fs,
    io::Read,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
static INSTALL_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
pub fn install() -> Result<std::path::PathBuf> {
    let _lock = INSTALL_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let dir = super::central_repo::dev_root().join("bridge");
    fs::create_dir_all(&dir)?;
    for (name, content) in [
        (
            "skill_workflow.py",
            include_str!("../../../scripts/skill_workflow.py"),
        ),
        (
            "workflow_discovery.py",
            include_str!("../../../scripts/workflow_discovery.py"),
        ),
    ] {
        let path = dir.join(name);
        if fs::read_to_string(&path).ok().as_deref() != Some(content) {
            let tmp = dir.join(format!("{name}.tmp"));
            fs::write(&tmp, content)?;
            fs::rename(tmp, path)?;
        }
    }
    Ok(dir.join("skill_workflow.py"))
}
pub fn call(args: &[&str]) -> Result<Value> {
    let mut child = Command::new("python3")
        .arg(install()?)
        .arg("--root")
        .arg(super::central_repo::dev_root())
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();
    let out = std::thread::spawn(move || {
        let mut s = String::new();
        stdout.read_to_string(&mut s).map(|_| s)
    });
    let err = std::thread::spawn(move || {
        let mut s = String::new();
        stderr.read_to_string(&mut s).map(|_| s)
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if start.elapsed() > Duration::from_secs(60) {
            child.kill()?;
            child.wait()?;
            bail!("workflow bridge timed out");
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let output = out
        .join()
        .map_err(|_| anyhow::anyhow!("bridge output reader"))??;
    let error = err
        .join()
        .map_err(|_| anyhow::anyhow!("bridge error reader"))??;
    if !status.success() {
        bail!(
            "workflow bridge: {}",
            error.chars().take(1000).collect::<String>()
        );
    }
    Ok(serde_json::from_str(&output)?)
}
pub fn names() -> Result<Vec<String>> {
    Ok(call(&["snapshot"])?["skills"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| s["name"].as_str().map(str::to_owned))
        .collect())
}
pub fn start() {
    std::thread::spawn(|| {
        let mut last_nmem: Option<Instant> = None;
        loop {
            match call(&["refresh"]) {
                Ok(value) => {
                    let names = value["skills"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(|s| s["name"].as_str().map(str::to_owned))
                        .collect();
                    if let Err(e) = super::usage_local::import(names) {
                        log::warn!("workflow observation: {e}");
                    }
                }
                Err(e) => log::warn!("workflow refresh: {e}"),
            }
            if last_nmem
                .map(|t| t.elapsed() > Duration::from_secs(600))
                .unwrap_or(true)
            {
                last_nmem = Some(Instant::now());
                if let Ok(events) = super::usage::events(None, 100) {
                    if let Some(event) = events.first() {
                        let req = super::usage::NmemImportRequest {
                            skill: event.skill.clone(),
                            project: None,
                            agent: None,
                            query: None,
                            space: None,
                            limit: Some(3),
                        };
                        match super::usage::import_nmem(req) {
                            Ok(report) => {
                                let _ = fs::write(
                                    super::central_repo::dev_root().join("nmem-auto-sync.json"),
                                    serde_json::to_vec(&report).unwrap_or_default(),
                                );
                            }
                            Err(e) => log::warn!("workflow nmem sync: {e}"),
                        }
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(60));
        }
    });
}
