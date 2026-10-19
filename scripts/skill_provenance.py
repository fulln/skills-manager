#!/usr/bin/env python3
"""Classify a managed skill by source provenance.

This module is deliberately independent of the database/UI.  Callers pass a
skill record enriched with its current effective directory and the stored
content hash from the last managed install/update.
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import Any

_IGNORED = {".git", ".DS_Store", "Thumbs.db", ".gitignore", "__pycache__"}


def content_hash(root: str | os.PathLike[str]) -> str:
    """Match Rust ``content_hash.rs``'s ordinary directory hash semantics."""
    base = Path(root)
    entries: list[Path] = []
    if not base.is_dir():
        raise OSError(f"not a directory: {base}")
    def fail(error: OSError) -> None:
        raise error
    for current, dirs, files in os.walk(base, topdown=True, followlinks=False, onerror=fail):
        dirs[:] = [name for name in dirs if name not in _IGNORED and not name.endswith(".pyc")]
        for name in files:
            path = Path(current) / name
            if name in _IGNORED or name.endswith(".pyc") or path.is_symlink():
                continue
            if not path.is_file():
                continue
            path.stat()
            entries.append(path)
    entries.sort(key=lambda p: p.relative_to(base).as_posix())
    digest = hashlib.sha256()
    for path in entries:
        digest.update(path.relative_to(base).as_posix().encode())
        try:
            digest.update(path.read_bytes())
            if os.name == "posix":
                digest.update((path.stat().st_mode & 0o111).to_bytes(4, "little"))
        except (OSError, ValueError):
            raise
    return digest.hexdigest()


def _remote(record: dict[str, Any]) -> bool:
    for key in ("source_ref", "source_ref_resolved", "source"):
        value = str(record.get(key) or "").strip().lower()
        if value.startswith(("http://", "https://", "git@", "ssh://")):
            return True
        if value.startswith("github.com/") and "/" in value[11:]:
            return True
    return record.get("source_type") in {"git", "skillssh"}


def _git_skill_remote(path: str) -> str | None:
    """Recover a remote only for a conventional repository ``skills/<name>``."""
    try:
        current = Path(path).expanduser().resolve()
    except (OSError, RuntimeError):
        return None
    for repo in [current, *list(current.parents)[:6]]:
        if ".skills-manager" in repo.parts:
            continue
        config = repo / ".git" / "config"
        if not config.is_file():
            continue
        try:
            relative = current.relative_to(repo)
            parts = relative.parts
            skills_index = parts.index("skills")
            if skills_index != 0 or len(parts) != 2:
                continue
            text = config.read_text(encoding="utf-8")
        except (OSError, ValueError, UnicodeDecodeError):
            continue
        match = re.search(r'\[remote\s+"origin"\][^\[]*?url\s*=\s*(\S+)', text, re.S)
        if match and _remote({"source_ref": match.group(1)}):
            return match.group(1)
    return None


def classify(raw: dict[str, Any]) -> dict[str, Any]:
    path = str(raw.get("path") or raw.get("central_path") or "")
    try:
        canonical_path = str(Path(path).expanduser().resolve()) if path else ""
    except (OSError, RuntimeError):
        canonical_path = path
    source_ref = raw.get("source_ref_resolved") or raw.get("source_ref") or raw.get("source") or ""
    if not _remote({"source_ref": source_ref}):
        for candidate in (raw.get("source_ref"), raw.get("source")):
            if candidate and _remote({"source_ref": candidate}):
                source_ref = candidate
                break
    explicit_remote = _remote(raw)
    inferred_remote = None if explicit_remote else _git_skill_remote(path)
    if inferred_remote:
        source_ref = inferred_remote
        raw = {**raw, "source_ref": inferred_remote, "source_type": "git"}
    result = {
        "category": "unknown",
        "category_reason": "未找到可验证的下载来源，待核对",
        "canonical_path": canonical_path,
        "source_ref": source_ref,
        "source": raw.get("source_type") or raw.get("source"),
        "source_revision": raw.get("source_revision"),
    }
    if not _remote(raw):
        skill_file = Path(path).expanduser() / "SKILL.md"
        if not path or not skill_file.is_file() or not os.access(skill_file, os.R_OK):
            result["category_reason"] = "本地路径不可读取或缺少 SKILL.md，来源待核对"
        return result
    if inferred_remote:
        result["category"] = "downloaded"
        result["source"] = "git"
        result["category_reason"] = "从技能仓库 origin 恢复来源，下载基线待核对"
        return result
    result["category"] = "downloaded"
    if raw.get("source_type") not in {"git", "skillssh"}:
        result["category_reason"] = "存在远端引用，但本地来源类型不是受管下载，下载基线待核对"
        return result
    result["category_reason"] = "存在受管远端来源"
    baseline = str(raw.get("content_hash") or "").strip().lower()
    if not baseline or not path or not os.path.isdir(path):
        result["category_reason"] = "存在远端来源，但缺少可验证的本地基线或目录"
        return result
    try:
        current = content_hash(path)
    except OSError:
        result["category_reason"] = "存在远端来源，但当前目录不可读取"
        return result
    if current != baseline:
        result["category"] = "downloaded_modified"
        result["category_reason"] = "当前内容哈希与最近一次受管下载基线不同"
    return result


__all__ = ["classify", "content_hash"]
