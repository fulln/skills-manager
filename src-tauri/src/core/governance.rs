//! Project and scope governance metadata. This database is deliberately separate
//! from the production skill store; it only references skill ids.
use anyhow::{anyhow, Result};
use rusqlite::{params, Connection};
use serde::Serialize;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct Scope {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub project_path: Option<String>,
    pub parent_id: Option<String>,
    pub created_at: i64,
}
#[derive(Debug, Clone, Serialize)]
pub struct ScopeSkill {
    pub scope_id: String,
    pub skill_id: String,
    pub role: String,
    pub excluded: bool,
    pub origin_scope_id: String,
    pub inherited: bool,
    pub overridden: bool,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn valid_kind(k: &str) -> bool {
    matches!(k, "global" | "domain" | "project")
}
fn valid_role(r: &str) -> bool {
    matches!(r, "orchestration" | "specialist" | "primitive")
}

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(p) = path.parent() {
        std::fs::create_dir_all(p)?;
    }
    let c = Connection::open(path)?;
    c.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS scopes(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,project_path TEXT,parent_id TEXT REFERENCES scopes(id) ON DELETE CASCADE,created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS scope_skills(scope_id TEXT NOT NULL REFERENCES scopes(id) ON DELETE CASCADE,skill_id TEXT NOT NULL,role TEXT NOT NULL,excluded INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope_id,skill_id));")?;
    c.busy_timeout(std::time::Duration::from_secs(5))?;
    c.execute_batch("CREATE UNIQUE INDEX IF NOT EXISTS scope_project_path ON scopes(project_path) WHERE project_path IS NOT NULL; CREATE UNIQUE INDEX IF NOT EXISTS scope_global ON scopes(kind) WHERE kind='global';")?;
    Ok(c)
}

pub fn list(c: &Connection) -> Result<Vec<Scope>> {
    let mut s = c.prepare(
        "SELECT id,name,kind,project_path,parent_id,created_at FROM scopes ORDER BY kind,name",
    )?;
    let rows = s.query_map([], |r| {
        Ok(Scope {
            id: r.get(0)?,
            name: r.get(1)?,
            kind: r.get(2)?,
            project_path: r.get(3)?,
            parent_id: r.get(4)?,
            created_at: r.get(5)?,
        })
    })?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}
pub fn add(
    c: &Connection,
    name: &str,
    kind: &str,
    path: Option<&str>,
    parent: Option<&str>,
) -> Result<Scope> {
    if name.trim().is_empty() || name.chars().count() > 120 {
        return Err(anyhow!("scope name must be 1-120 characters"));
    };
    if !valid_kind(kind) {
        return Err(anyhow!("invalid scope kind"));
    };
    if kind == "global" && parent.is_some() {
        return Err(anyhow!("global scope cannot have a parent"));
    };
    if kind == "project"
        && path
            .map(|p| !std::path::Path::new(p).is_absolute())
            .unwrap_or(false)
    {
        return Err(anyhow!("project path must be absolute"));
    };
    if let Some(p) = parent {
        let pk: String = c
            .query_row("SELECT kind FROM scopes WHERE id=?1", params![p], |r| {
                r.get(0)
            })
            .map_err(|_| anyhow!("parent scope not found"))?;
        if kind == "domain" && pk == "project" {
            return Err(anyhow!("domain cannot be child of project"));
        };
    }
    if kind == "global"
        && c.query_row("SELECT 1 FROM scopes WHERE kind='global'", [], |r| {
            r.get::<_, i32>(0)
        })
        .is_ok()
    {
        return Err(anyhow!("only one global scope is allowed"));
    }
    let normalized_path = path.filter(|p| !p.trim().is_empty()).map(|p| {
        let p = Path::new(p.trim());
        p.canonicalize()
            .unwrap_or_else(|_| {
                let mut out = std::path::PathBuf::new();
                for part in p.components() {
                    match part {
                        std::path::Component::CurDir => {}
                        std::path::Component::ParentDir => {
                            out.pop();
                        }
                        other => out.push(other.as_os_str()),
                    }
                }
                out
            })
            .to_string_lossy()
            .to_string()
    });
    if kind != "project" && normalized_path.is_some() {
        return Err(anyhow!("only projects may have a path"));
    }
    let path = normalized_path.as_deref();
    let id = Uuid::new_v4().to_string();
    let t = now();
    c.execute(
        "INSERT INTO scopes VALUES(?1,?2,?3,?4,?5,?6)",
        params![id, name.trim(), kind, path, parent, t],
    )?;
    Ok(Scope {
        id,
        name: name.trim().into(),
        kind: kind.into(),
        project_path: path.map(str::to_owned),
        parent_id: parent.map(str::to_owned),
        created_at: t,
    })
}
pub fn attach(c: &Connection, scope: &str, skill: &str, role: &str, excluded: bool) -> Result<()> {
    if !valid_role(role) {
        return Err(anyhow!("invalid skill role"));
    };
    if c.query_row("SELECT id FROM scopes WHERE id=?1", params![scope], |r| {
        r.get::<_, String>(0)
    })
    .is_err()
    {
        return Err(anyhow!("scope not found"));
    };
    c.execute("INSERT INTO scope_skills VALUES(?1,?2,?3,?4) ON CONFLICT(scope_id,skill_id) DO UPDATE SET role=excluded.role,excluded=excluded.excluded",params![scope,skill,role,excluded as i32])?;
    Ok(())
}
pub fn remove(c: &Connection, scope: &str, skill: &str) -> Result<()> {
    c.execute(
        "DELETE FROM scope_skills WHERE scope_id=?1 AND skill_id=?2",
        params![scope, skill],
    )?;
    Ok(())
}
pub fn reparent(c: &Connection, scope: &str, parent: Option<&str>) -> Result<()> {
    if parent == Some(scope) {
        return Err(anyhow!("scope cannot parent itself"));
    };
    let exists: bool = c.query_row(
        "SELECT EXISTS(SELECT 1 FROM scopes WHERE id=?1)",
        params![scope],
        |r| r.get(0),
    )?;
    if !exists {
        return Err(anyhow!("scope not found"));
    };
    let kind: String = c.query_row("SELECT kind FROM scopes WHERE id=?1", params![scope], |r| {
        r.get(0)
    })?;
    if kind == "global" && parent.is_some() {
        return Err(anyhow!("global scope cannot have a parent"));
    }
    if let Some(p) = parent {
        let pk: String = c
            .query_row("SELECT kind FROM scopes WHERE id=?1", params![p], |r| {
                r.get(0)
            })
            .map_err(|_| anyhow!("parent scope not found"))?;
        if kind == "domain" && pk == "project" {
            return Err(anyhow!("domain cannot be child of project"));
        }
        let pexists: bool = c.query_row(
            "SELECT EXISTS(SELECT 1 FROM scopes WHERE id=?1)",
            params![p],
            |r| r.get(0),
        )?;
        if !pexists {
            return Err(anyhow!("parent scope not found"));
        };
        let mut cur = Some(p.to_string());
        let mut visited = std::collections::HashSet::new();
        while let Some(id) = cur {
            if !visited.insert(id.clone()) {
                return Err(anyhow!("existing scope hierarchy cycle"));
            }
            if id == scope {
                return Err(anyhow!("scope hierarchy cycle"));
            };
            cur = c.query_row(
                "SELECT parent_id FROM scopes WHERE id=?1",
                params![id],
                |r| r.get(0),
            )?;
        }
    }
    c.execute(
        "UPDATE scopes SET parent_id=?1 WHERE id=?2",
        params![parent, scope],
    )?;
    Ok(())
}
pub fn effective(c: &Connection, scope: &str) -> Result<Vec<ScopeSkill>> {
    let mut chain = Vec::new();
    let mut cur = Some(scope.to_string());
    while let Some(id) = cur {
        let row: Option<String> = c
            .query_row(
                "SELECT parent_id FROM scopes WHERE id=?1",
                params![id],
                |r| r.get(0),
            )
            .map_err(|_| anyhow!("scope not found"))?;
        if chain.contains(&id) {
            return Err(anyhow!("scope hierarchy cycle"));
        };
        chain.push(id);
        cur = row;
    }
    let mut out = Vec::new();
    for (depth, id) in chain.iter().enumerate().rev() {
        let mut st =
            c.prepare("SELECT skill_id,role,excluded FROM scope_skills WHERE scope_id=?1")?;
        for r in st.query_map(params![id], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i32>(2)?,
            ))
        })? {
            let (skill, role, excluded) = r?;
            if let Some(x) = out
                .iter_mut()
                .find(|x: &&mut ScopeSkill| x.skill_id == skill)
            {
                x.role = role;
                x.excluded = excluded != 0;
                x.origin_scope_id = id.clone();
                x.inherited = depth > 0;
                x.overridden = true;
            } else {
                out.push(ScopeSkill {
                    scope_id: scope.into(),
                    skill_id: skill,
                    role,
                    excluded: excluded != 0,
                    origin_scope_id: id.clone(),
                    inherited: depth > 0,
                    overridden: false,
                });
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn db() -> (tempfile::TempDir, Connection) {
        let d = tempfile::tempdir().unwrap();
        let c = open(&d.path().join("governance.db")).unwrap();
        (d, c)
    }
    #[test]
    fn three_levels_inherit_role_and_origin() {
        let (_d, c) = db();
        let g = add(&c, "Global", "global", None, None).unwrap();
        let d = add(&c, "Content", "domain", None, Some(&g.id)).unwrap();
        let p = add(
            &c,
            "Research",
            "project",
            Some("/tmp/research"),
            Some(&d.id),
        )
        .unwrap();
        attach(&c, &g.id, "tts", "primitive", false).unwrap();
        let rows = effective(&c, &p.id).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].inherited);
        assert_eq!(rows[0].role, "primitive");
        assert_eq!(rows[0].origin_scope_id, g.id);
    }
    #[test]
    fn override_reset_and_exclusion() {
        let (_d, c) = db();
        let g = add(&c, "Global", "global", None, None).unwrap();
        let p = add(&c, "P", "project", None, Some(&g.id)).unwrap();
        attach(&c, &g.id, "tts", "primitive", false).unwrap();
        attach(&c, &p.id, "tts", "specialist", true).unwrap();
        let rows = effective(&c, &p.id).unwrap();
        assert!(rows[0].excluded && rows[0].overridden && !rows[0].inherited);
        remove(&c, &p.id, "tts").unwrap();
        let rows = effective(&c, &p.id).unwrap();
        assert!(!rows[0].excluded && rows[0].inherited);
        assert_eq!(rows[0].role, "primitive");
    }
    #[test]
    fn invalid_names_kind_and_parent() {
        let (_d, c) = db();
        assert!(add(&c, " ", "global", None, None).is_err());
        assert!(add(&c, "ok", "wrong", None, None).is_err());
        assert!(add(&c, "P", "project", None, Some("missing")).is_err());
    }
    #[test]
    fn single_global_and_no_parent() {
        let (_d, c) = db();
        let g = add(&c, "Global", "global", None, None).unwrap();
        assert!(add(&c, "Other", "global", None, None).is_err());
        assert!(add(&c, "Other", "global", None, Some(&g.id)).is_err());
    }
    #[test]
    fn validates_parent_rank_on_add_and_reparent() {
        let (_d, c) = db();
        let g = add(&c, "G", "global", None, None).unwrap();
        let p = add(&c, "P", "project", None, Some(&g.id)).unwrap();
        let d = add(&c, "D", "domain", None, Some(&g.id)).unwrap();
        assert!(add(&c, "D2", "domain", None, Some(&p.id)).is_err());
        assert!(reparent(&c, &d.id, Some(&p.id)).is_err());
        assert!(reparent(&c, &g.id, Some(&p.id)).is_err());
    }
    #[test]
    fn rejects_reparent_cycles_and_missing_scopes() {
        let (_d, c) = db();
        let p = add(&c, "P", "project", None, None).unwrap();
        let child = add(&c, "C", "project", None, Some(&p.id)).unwrap();
        assert!(reparent(&c, &p.id, Some(&child.id)).is_err());
        assert!(reparent(&c, &p.id, Some(&p.id)).is_err());
        assert!(reparent(&c, "missing", None).is_err());
        assert!(reparent(&c, &p.id, Some("missing")).is_err());
    }
    #[test]
    fn invalid_scope_and_roles_fail() {
        let (_d, c) = db();
        assert!(effective(&c, "missing").is_err());
        assert!(attach(&c, "missing", "s", "primitive", false).is_err());
        let p = add(&c, "P", "project", None, None).unwrap();
        assert!(attach(&c, &p.id, "s", "wrong", false).is_err());
    }
    #[test]
    fn paths_are_absolute_normalized_and_unique() {
        let (_d, c) = db();
        assert!(add(&c, "P", "project", Some("relative"), None).is_err());
        let p = add(&c, "P", "project", Some("/tmp/a/../unique-project"), None).unwrap();
        assert!(p.project_path.unwrap().ends_with("/unique-project"));
        assert!(add(&c, "P2", "project", Some("/tmp/unique-project"), None).is_err());
        assert!(add(&c, "D", "domain", Some("/tmp/d"), None).is_err());
    }
    #[test]
    fn reparent_changes_effective_skills() {
        let (_d, c) = db();
        let g = add(&c, "G", "global", None, None).unwrap();
        let d = add(&c, "D", "domain", None, Some(&g.id)).unwrap();
        let p = add(&c, "P", "project", None, None).unwrap();
        attach(&c, &d.id, "tts", "primitive", false).unwrap();
        assert!(effective(&c, &p.id).unwrap().is_empty());
        reparent(&c, &p.id, Some(&d.id)).unwrap();
        assert_eq!(effective(&c, &p.id).unwrap().len(), 1);
    }
}
