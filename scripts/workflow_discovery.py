"""Read-only discovery and isolated governance sync for the dev build.

The module deliberately uses only the standard library so it can run with the
macOS system Python. Discovery never mutates the user's skill catalog.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable, Optional

MARKERS = (".git", "AGENTS.md", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "requirements.txt")
SKILL_DIRS = (".agents/skills", ".codex/skills", ".claude/skills", ".gemini/skills")
IGNORED = {".git", ".cache", "node_modules", "target", ".venv", "venv", ".skills-manager", ".agents", "worktrees", "archive", "archived", ".next", ".worktrees", "build", "dist", "work", "runtime-pkg", ".codex", ".config", ".slock"}
ROLE_WORDS = {"orchestration": ("workflow", "pipeline", "autopilot", "ops", "content"), "primitive": ("cli", "tool", "utility", "shared"), "specialist": ()}


def _canon(p: Path) -> Optional[Path]:
    try:
        return p.expanduser().resolve(strict=True)
    except OSError:
        return None


def _skill_record(raw: dict[str, Any], *, local: bool = False, path: Optional[Path] = None) -> dict[str, Any]:
    name = str(raw.get("name") or raw.get("id") or (path.name if path else "unknown"))
    resolved_path = path.parent if path and path.name == "SKILL.md" else path
    if resolved_path is None:
        options=[raw.get("source_ref"),raw.get("path")]
        resolved_path=next((Path(v).expanduser() for v in options if v and (Path(v).expanduser()/"SKILL.md").is_file()),Path(raw.get("path") or "__missing__"))
    return {"id": str(raw.get("id") or ("local-" + hashlib.sha256(str(path).encode()).hexdigest()[:16])),
            "name": name, "description": str(raw.get("description") or ""),
            "path": str(resolved_path), "skill_file": str(path or raw.get("skill_file") or ""), "tags": list(raw.get("tags") or []),
            "deployed_to": list(raw.get("deployed_to") or []), "source": str(raw.get("source_type") or raw.get("source") or ("project-local" if local else ""))}


def _catalog(cli: str) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []
    try:
        command = [cli, "--json", "skills", "list"] if not cli.endswith(".py") else [sys.executable, cli, "--json", "skills", "list"]
        proc = subprocess.run(command, capture_output=True, text=True, timeout=15)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or "catalog command failed")
        data = json.loads(proc.stdout)
        if isinstance(data, dict): data = data.get("skills", data.get("items", []))
        return [_skill_record(x) for x in data if isinstance(x, dict)], warnings
    except Exception as exc:
        warnings.append("skills catalog unavailable: " + str(exc))
        return [], warnings


def _config_projects(home: Path) -> list[Path]:
    cfg = home / ".codex/config.toml"
    if not cfg.is_file(): return []
    text = cfg.read_text(errors="replace")
    # Project keys are TOML tables such as [projects."/absolute/path"].
    return [Path(x) for x in re.findall(r"^\s*\[projects\.\"([^\"]+)\"\]", text, re.M)]


def _candidate_projects(home: Path, roots: Optional[Iterable[Path]]) -> list[Path]:
    base = list(roots or (home / "opt", home / "opensource", home / "Documents/ChatGPT")) + _config_projects(home)
    found: dict[str, Path] = {}
    for root in base:
        p = _canon(Path(root))
        if not p: continue
        if any(part in IGNORED or part.endswith("-worktrees") for part in p.parts): continue
        if any((p / m).exists() for m in MARKERS):
            found[str(p)] = p
            continue
        try:
            for child in p.iterdir():
                if not child.is_dir() or (child.name in IGNORED or child.name.endswith("-worktrees")) or child.is_symlink(): continue
                cp = _canon(child)
                if cp and any((cp / m).exists() for m in MARKERS):
                    found[str(cp)] = cp
                    continue
                # bounded scan, depth <= 3 from supplied root
                for grand in (child.iterdir() if child.is_dir() else ()):
                    if grand.is_dir() and grand.name not in IGNORED and not grand.is_symlink():
                        gp = _canon(grand)
                        if gp and any((gp / m).exists() for m in MARKERS): found[str(gp)] = gp
        except OSError: pass
    # A registered nested application can remain a project; incidental package subfolders cannot.
    return sorted(found.values(), key=str)


def _local_skills(project: Path) -> list[dict[str, Any]]:
    found: dict[str, dict[str, Any]] = {}
    for rel in SKILL_DIRS:
        base = project / rel
        if not base.is_dir(): continue
        try: paths = [p for p in base.glob("*/SKILL.md") if p.is_file()]
        except OSError: paths = []
        for p in paths:
            cp = _canon(p)
            if not cp: continue
            name = cp.parent.name
            desc = ""
            try:
                first = cp.read_text(errors="replace")[:4000]
                m = re.search(r"^description:\s*[|>]?[ \t]*(.*)$", first, re.M)
                desc = (m.group(1).strip() if m else "")
                nm = re.search(r"^name:\s*[\"']?([^\"'\n]+)", first, re.M)
                if nm: name = nm.group(1).strip()
            except OSError: pass
            rec = _skill_record({"name": name, "description": desc}, local=True, path=cp)
            found[name] = rec  # later dirs override earlier ones
    return sorted(found.values(), key=lambda x: x["name"])


def _domain(path: Path, home: Path) -> str:
    text = path.name.lower() + " " + " ".join(p.name.lower() for p in path.iterdir() if p.is_file())
    if any((path / x).exists() for x in ("package.json", "pyproject.toml", "Cargo.toml", "go.mod")): return "软件开发"
    if any(x in text for x in ("story", "stories", "gzh", "ytb", "youtube")): return "内容创作"
    if any(x in text for x in ("video", "content", "xhs", "article")): return "内容创作"
    if any(x in text for x in ("research", "finance", "stock", "投研")): return "研究"
    if any(x in text for x in ("software", "app", "code", "project")): return "软件开发"
    return "个人项目"


def discover(home: Path, roots: Optional[Iterable[Path]] = None, cli: Optional[str] = None) -> dict[str, Any]:
    home = Path(home).expanduser()
    catalog, warnings = _catalog(cli or str(home / ".skills-manager/bin/skills-manager-cli"))
    configured = {str(p.expanduser().resolve()) for p in _config_projects(home)}
    projects = []
    for p in _candidate_projects(home, roots):
        projects.append({"path": str(p), "name": p.name, "domain": _domain(p, home), "source": "codex-config" if str(p) in configured else "filesystem", "skills": _local_skills(p)})
    return {"projects": projects, "skills": catalog, "warnings": warnings}


def _role(skill: dict[str, Any]) -> str:
    text = (skill.get("name", "") + " " + skill.get("description", "")).lower()
    for role, words in ROLE_WORDS.items():
        if any(w in text for w in words): return role
    return "specialist"


def sync_governance(root: Path, discovery: dict[str, Any]) -> dict[str, int]:
    """Upsert auto-discovered scopes/bindings into the development DB only."""
    root = Path(root)
    dbpath = root / "library" / "skills-governance.sqlite3"
    dbpath.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(dbpath)
    db.executescript("CREATE TABLE IF NOT EXISTS scopes(id TEXT PRIMARY KEY,name TEXT NOT NULL,kind TEXT NOT NULL,project_path TEXT,parent_id TEXT,created_at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS scope_skills(scope_id TEXT NOT NULL,skill_id TEXT NOT NULL,role TEXT NOT NULL,excluded INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(scope_id,skill_id)); CREATE TABLE IF NOT EXISTS discovery_sources(skill_id TEXT PRIMARY KEY,path TEXT NOT NULL,source TEXT NOT NULL,metadata TEXT NOT NULL);")
    now = int(__import__("time").time()); counts = {"projects": 0, "skills": 0}
    grow = db.execute("SELECT id FROM scopes WHERE kind='global' LIMIT 1").fetchone()
    gid = grow[0] if grow else 'global'
    db.execute("INSERT OR IGNORE INTO scopes(id,name,kind,project_path,parent_id,created_at) VALUES(?, 'Global','global',NULL,NULL,?)", (gid, now))
    domains: dict[str, str] = {}
    for item in discovery.get("projects", []):
        dom = item.get("domain") or "local"; did = "domain-" + hashlib.sha256(dom.encode()).hexdigest()[:16]
        db.execute("INSERT OR IGNORE INTO scopes(id,name,kind,project_path,parent_id,created_at) VALUES(?,?, 'domain',NULL,?,?)", (did, dom, gid, now)); domains[dom] = did
        existing = db.execute("SELECT id FROM scopes WHERE kind='project' AND project_path=?", (item["path"],)).fetchone()
        pid = existing[0] if existing else "project-" + hashlib.sha256(item["path"].encode()).hexdigest()[:16]
        db.execute("INSERT OR IGNORE INTO scopes(id,name,kind,project_path,parent_id,created_at) VALUES(?,?, 'project',?,?,?)", (pid, item.get("name", Path(item["path"]).name), item["path"], did, now)); counts["projects"] += 1
        for skill in item.get("skills", []):
            sid = skill["id"]; db.execute("INSERT OR IGNORE INTO scope_skills(scope_id,skill_id,role,excluded) VALUES(?,?,?,0)", (pid, sid, _role(skill))); db.execute("INSERT OR REPLACE INTO discovery_sources VALUES(?,?,?,?)", (sid, skill["path"], "project-local", json.dumps({"name": skill["name"], "inferred_role": _role(skill)}, ensure_ascii=False))); counts["skills"] += 1
    for skill in discovery.get("skills", []):
        db.execute("INSERT OR IGNORE INTO scope_skills(scope_id,skill_id,role,excluded) VALUES(?,?,?,0)", (gid, skill["id"], _role(skill)))
        db.execute("INSERT OR REPLACE INTO discovery_sources VALUES(?,?,?,?)", (skill["id"], skill["path"], skill.get("source", "catalog"), json.dumps({"name": skill["name"], "inferred_role": _role(skill)}, ensure_ascii=False)))
    db.commit(); db.close(); return counts
