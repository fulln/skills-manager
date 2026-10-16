# Skills Manager Dev (fulln fork)

Independent development app based on xingkongliang/skills-manager v1.42.0.
The upstream MIT notice is retained. No new runtime dependencies were added.

## Run

```sh
npm ci
# Optional: make an independent copy of an existing library. Destination must not exist.
python3 scripts/snapshot-dev-library.py \
  --source "$HOME/.skills-manager" --destination "$PWD/.dev-data/library"
SKILLS_MANAGER_DEV_ROOT="$PWD/.dev-data" npm run tauri:dev
```

`SKILLS_MANAGER_DEV_ROOT` must be absolute. Without it, the app uses the platform
local-data directory's `skills-manager-dev` folder. Its library, governance DB,
usage DB, configuration, and simulated agent home live separately. Development
and packaged builds use `com.agentskills.desktop.dev` and `Skills Manager Dev`.

To package: `npm run tauri -- build --debug --bundles app`. The Cargo configuration
builds liblzma statically to avoid Intel Homebrew libraries on Apple Silicon.

## First version

- Project hierarchy page: global/domain/project scopes; optional absolute project
  roots; parent changes with cycle validation; orchestration/specialist/primitive
  responsibilities; inherited, overridden, excluded and restored skill bindings.
- Bindings are **planning metadata**, not a promise that an AI runtime applies
  that inheritance. This version never rewrites real project skill folders.
- Local usage collection reads at most 100 most recently modified Codex/Claude
  JSONL files (20MB each). Project attribution uses the longest matching registered
  project root. Other records stay unassigned.
- Frequency is the number of observed source-session/skill pairs, grouped over
  rolling 7/30/90 days. It is not invocation count or task success rate. The three
  evidence kinds are explicit invocation, assistant declaration, and file-read
  inference. A catalog entry or ordinary mention never counts.
- nmem uses the existing CLI identity/Space, `fs capabilities`, and a bounded
  `fs grep` search. Exact message offsets allow one bounded thread read per import
  (8 messages, 1200 characters each). A task keyword filters the returned snippets;
  it does not search the whole archive. Every imported event keeps its provenance.
- nmem currently supplements declarations from saved conversations. Its results
  do not assert complete tool-call history. Missing logs, capped scans, discarded
  subagent formats and unavailable nmem leave coverage gaps.
- Same-session/skill imports are idempotent across the supported sources when
  canonical session IDs agree. Stronger evidence upgrades the existing record.
  A conflicting project assignment is rejected instead of multiplying counts.
- Historical events do not know which skill version was loaded. Same-name library
  variants appear separately in the catalog, but usage is grouped by skill name.

## Production protection

Snapshot import copies skill content and tags into a fresh store. It excludes
production deployments, projects, presets, settings, credentials and backup
remotes. Local source paths are repointed at the copied content. Symlinks inside
skills cause a refusal; secrets named `.env*` and dependency caches are excluded.
The script opens only a private database copy, not the production database.

Legacy upstream write commands are blocked by an IPC allowlist. Governance and
usage commands write only independent databases. Upstream app updater, CLI bridge
publishing, automatic skill updates and automatic remote backup are disabled.
Real JSONL logs and nmem are read-only sources. Runtime `.dev-data` is gitignored;
never commit copied skills, private conversations, database files or access keys.

The existing formal app and `~/.skills-manager/bin/skills-manager-cli` continue
using their own original library. Do not point the development root at an agent
or production library directory.

## Checks

```sh
npm run lint
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
python3 -m unittest discover -s scripts -p 'test_snapshot_dev_library.py' -v
# Optional explicit integration check: requires this user's saved sample thread.
cargo test --manifest-path src-tauri/Cargo.toml --lib live_nmem_import -- --ignored
```

The upstream npm lockfile currently reports audit findings. Dependencies are
unchanged in this implementation; dependency upgrades need their own review.
The optimization workbench and optimization evaluation are future work.

A separate `skills-manager-dev-tools` binary exposes `status`, `collect-local`,
`import-nmem SKILL [PROJECT_ID]`, and `summary` for explicit headless checks or AI
use. It uses the same isolated development root; it is never published over the
formal app's CLI bridge.

The optional `scripts/ui-smoke.cjs` runs headless UI contract checks with an
existing Playwright installation (`SKILLS_MANAGER_PLAYWRIGHT` may point at it).
It uses mocked Tauri responses; native app and real nmem tests are separate.
