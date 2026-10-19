# Development build verification — 2026-10-16

## Delivered behavior

- Independent macOS app: `Skills Manager Dev`, bundle ID `com.agentskills.desktop.dev`.
- Project hierarchy: scope creation, validated parent changes, inheritance,
  responsibility override, local exclusion and restoration of parent rules.
- Usage: rolling 7/30/90-day evidence counts, project filter, source excerpts,
  read-only Codex/Claude JSONL collection, and bounded nmem history imports.
- Existing library: 99 skill records/content copies imported into development
  storage. Production deployments, settings, credentials and remotes were excluded.

## Checks and observed results

| Check | Result |
|---|---|
| `npm run lint` | Pass, including UI-scale and locale consistency checks |
| `npm run build` / Tauri frontend build | Pass |
| Rust library suite | 623 passed, 8 ignored |
| Explicit live nmem integration test | 1 passed separately |
| Snapshot isolation tests | 3 passed |
| `cargo clippy --lib --no-deps` | Completed; 20 warnings in upstream code, none in the new governance/usage modules |
| macOS debug app bundle | Built successfully |
| Headless frontend contract tests | Pass: three levels, inherited skill, exclude/reset, import refresh, evidence expansion, no document overflow |
| Native macOS app | Verified real scope creation, inherited skill, exclusion to zero effective skills, restoration, nmem connection, real import and repeat-import deduplication |
| Real local collection | Scanned 100 recent files; 30 unique session/skill evidence records; 162 files outside coverage or oversized; 0 malformed lines |
| Repeat local collection | 0 new records; 51 repeated observations skipped |
| nmem/local identity reconciliation | Matching nmem evidence skipped rather than double counted |
| Production integrity comparison | 102 file hashes and 43 deployment symlinks unchanged |

Native QA used a separate repository-local data root. The delivered app defaults
to its separate platform app-data root, preloaded with the 99 copied skills and
30 real evidence records. No QA-only scopes were copied into that default root.
Private logs, evidence, library copies and screenshots are ignored by Git.

## Limits

Counts mean observed source-session/skill pairs, not exact calls or successful
business tasks. nmem imports declarations conservatively; they do not prove tool
execution. Scanning is bounded (100 recent JSONL files, max 20MB per file); older,
deleted and other-agent logs are not covered. Same-name variants are aggregated
by name because historical events usually lack a skill ID/version. Project
inheritance currently controls governance metadata, not AI runtime loading.

Upstream production write commands are blocked in this first development build;
existing formal deployment continues in the original app. The optimization
workbench is not part of this version.

The inherited npm lockfile reports 20 audit findings (2 low, 3 moderate, 15 high).
No dependency versions were changed; dependency remediation remains separate.
