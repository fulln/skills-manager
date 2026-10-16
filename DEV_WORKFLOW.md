# Live project workflow development edition

This fork reads the existing Skills Manager catalog through its official JSON CLI. It automatically discovers existing Codex projects and repositories under `~/opt`, `~/opensource` and `~/Documents/ChatGPT`, plus project-local skills. Source skill instructions remain in their existing directories. Runtime data and installed bridge live under `~/Library/Application Support/skills-manager-dev`.

The native home page now presents the current project, task recommendations, execution history and effective skills. Governance retains global → domain → project inheritance, exclusions and local overrides. Usage displays source evidence and rolling 7/30/90-day counts.

## AI integration

The embedded Python standard-library bridge exposes:

```sh
python3 skill_workflow.py recommend --project /absolute/project --task 'Analyze the architecture' --agent codex
python3 skill_workflow.py run --run-id RETURNED_ID --skill CANDIDATE_ID --artifact /absolute/new-report.md -- python3 report_script.py
```

`recommend` refreshes the live catalog and records a selection. It returns at most five lexical candidates, paths and reasons. The host AI must read the skill and judge applicability. `run` executes an argv array without a shell in the actual project, checks current exclusions, records status and artifact hashes, and adds one explicit usage event. A failed attempt still counts as invocation; success is a separate run status. Existing unmodified artifacts do not establish successful output.

On this host, the existing `personal-skill-ops` skill and the managed sections of Codex/Claude/Pi instructions route suitable project tasks through this bridge. This is instruction-based routing, not interception of every AI action. New sessions read refreshed instructions; already-running agents must refresh their instructions. Direct terminal bridge calls work without the app open.

The running app refreshes live discovery and bounded Codex/Claude log observation approximately every minute. Every ten minutes it checks a recently observed skill against nmem using the current identity/space and the existing bounded importer. Historical evidence can be incomplete. Manual history verification remains available under an advanced disclosure.

## Isolation and limits

- Default mode remains isolated and read-only for production skills. Explicit local opt-in `~/Library/Application Support/skills-manager-dev/management.json` containing `{"manage_existing_library":true}` lets Dev manage the existing shared library using upstream install/update/delete/deployment handlers. Restart after changing mode; `SKILLS_MANAGER_DEV_ROOT` always forces sandbox mode.
- In management mode the shared catalog stays in `~/.skills-manager` (or its existing configured location). Governance and usage stay in `skills-manager-dev/library`, alongside the Python workflow ledger. Startup does not reapply presets or re-enable skills. Remote backup, library relocation, custom target configuration and app updater remain unavailable in this edition.
- The verified upstream CLI at `~/.skills-manager/bin` is retained, along with a bundled copy. Removing the original desktop bundle must never remove this bridge or the shared skill library.
- Workflow/governance/usage databases live in the development namespace. Python uses a process lock for refresh, SQLite transactions, and atomic sync-status replacement.
- Runtime copies no longer need users to create scopes or import each skill. Current task directories with real project markers can register automatically.
- Domains and roles are initially inferred. Users can adjust governance metadata; refresh preserves exclusions and overrides.
- Plugin/system skills stay under their own managers. The development bridge does not install a second plugin manager.
- This local integration targets macOS system Python; `fcntl` is used for interprocess locking.
- No new dependencies or external telemetry were introduced. There is no LLM optimization engine or automatic rewriting of production skills in this edition.

## Real validation

`storys_checker` was discovered from its existing directory. A Chinese architecture-analysis request selected `architecture-analyzer` first. Following that skill, a read-only source inspection generated an architecture report and eight source evidence records; execution succeeded and one explicit invocation was recorded against the governance project ID. Merely selecting the skill created no usage event. Project content was unchanged.

Validation includes Python discovery/workflow regressions, the existing Rust library suite, frontend typecheck/build/lint, and native Tauri window verification. The repository's pre-existing Clippy warnings remain outside this feature.

## Useful related projects

Reviewed from GitHub Trending and related discovery; no code or dependencies copied:

- https://github.com/affaan-m/ECC — observations/instincts evolving into reviewed skill improvements.
- https://github.com/obra/superpowers — workflow-stage skill triggering and diagnosis.
- https://github.com/mksglu/context-mode — hooks, usage/session metrics and collection diagnostics.
- https://github.com/ruvnet/ruflo — routing, execution outcomes and experience reuse.
- https://github.com/yusing/skills-mgr — project effective selections and inspectable conditions.

Next optimization work should use task outcome evidence and trigger diagnostics, rather than treating high frequency as proof of skill quality.
