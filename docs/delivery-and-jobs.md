# Исполняемый IDE, задания и сравнение версий

## Владельцы и идентичности

- Authored project: обычные TS imports. `targets/deployment.ts` использует существующий `DeploymentPlan`; отчёты используют существующий `Report`, optional `schedule` расширяет его.
- Workspace: Git, точный commit в отдельном worktree, frozen install, загрузка authored плана. Runtime не читает source.
- Workflow SDK в `saturn-saas`: долговечные шаги, зависимости, ожидание. GitHub Actions остаётся экспортом того же плана.
- Bun worker host: bounded queue и выполнение конкретного шага. `runtime/jobs` хранит execution receipts, не планирует DAG. Это не вторая реализация Workflow SDK.
- Runtime: BuildArtifact, archive и provenance измерений. Shell: navigation, формы, графики.

Версия IDE, source commit, checked build, published и applied — разные идентичности. Обновление IDE не делает pull проекта. Pull/restore не применяет live build. Обычный simulator preview остаётся отключаемым.

## Один исполняемый файл

```sh
bun run ide:build
bun scripts/ide-smoke.ts
./artifacts/distribution/saturn-darwin-arm64 gui --project /path/to/station
./artifacts/distribution/saturn-darwin-arm64 cli --json runtime status
./artifacts/distribution/saturn-darwin-arm64 tui
```

`gui` открывает системный браузер; `serve` запускает тот же host без открытия. `--manual` отключает simulator auto-preview. `--port 0` выбирает свободный порт.

Bun executable содержит compressed payload исходников IDE, TS/type libraries, browser renderer и production dependencies, включая native OpenTUI. Payload проверяется SHA-256 и раскрывается атомарно в `~/.saturn/ide/<version>-<digest>`; проект не получает копию IDE. Встроенный Bun запускает host через `BUN_BE_BUN=1`. Пользовательские данные отдельно в `~/.saturn/workspaces`. Git нужен для операций с репозиторием; зависимости и hardware toolchains инженерного проекта остаются его обязанностью.

`ide-release.yml` выполняет native build + smoke на Windows x64, Linux x64/ARM64, macOS Intel/ARM64. Manifest выпускается только после всех runners; размеры/checksums пересчитываются по бинарникам. Workflow создаёт **draft** release, а не незаметное публичное обновление. Подпись/notarization пока не настроены. Локальный smoke macOS не является доказательством работы Windows/Linux.

Публикуемый `manifest.json` содержит version, sourceRevision, publishedAt, notesUrl и assets. Сайт `/api/downloads` и sidebar IDE читают **один manifest**; переменная `SATURN_IDE_MANIFEST_URL` позволяет использовать отдельное HTTPS хранилище. По умолчанию сайт читает GitHub latest release. Приватный GitHub release не становится публично скачиваемым через эту настройку: для общедоступного сайта нужны публичные assets/CDN. До публикации UI показывает недоступность, а не фиктивные ссылки.

IDE проверяет выпуск по кнопке и каждые 30 минут после открытия; предлагает скачать подходящий файл. Самозамена работающего executable не реализована.

## Bun worker server

```json
{
  "directory": "/var/lib/saturn/worker",
  "hostname": "127.0.0.1",
  "port": 3200,
  "concurrency": 2,
  "projects": {
    "owner/station": {
      "root": "/srv/repos/station",
      "database": "sqlite:///var/lib/saturn/operator/history.sqlite",
      "environments": {
        "production": { "SATURN_DEPLOY_URL": "https://operator.example" },
        "controller": { "PLC_HOST": "192.0.2.10" }
      }
    }
  }
}
```

```sh
# SATURN_WORKER_TOKEN — 32–256 URL-safe characters, injected through service environment
bun src/host/worker.ts /etc/saturn/worker.json
# Installed executable also supports: saturn worker /etc/saturn/worker.json
```

Worker serves only registered projects, authenticates a server-side bearer token, rejects browser Origin requests. Per-step environment is provisioned by the server; callers cannot send arbitrary argv or secret values. Authored source executes as trusted project code in a Bun Worker with subprocesses. This is failure isolation, **not** a security sandbox for hostile tenants; use separate OS users/containers for those. CPU/memory limits, quotas and per-tenant containers are not implemented here.

Workflow dispatches `prepare` at exact reviewed SHA → DAG steps from retained authored plan. Each step gets its own exact-commit worktree and frozen install, matching the existing GitHub export. Dependency results establish order; implicit sharing of mutable build directories is not supported. Transfer of files between steps needs explicit project commands/artifact storage. A step runs only after its dependencies succeed; independent branches can finish even when another target fails. Source preparation performs a network fetch and frozen install; runner must already have repository access. The configured target command is responsible for using the existing checked-artifact deploy API with explicit expected published/applied identities. A zero exit code is a command result, not independent proof of physical flashing. No compiler/firmware is fabricated.

Receipts: queued/running/succeeded/failed/interrupted; idempotency key = SDK run + task/step. Reuse with different input is rejected. SQLite persists input/result/error. Completed steps are not executed again. After a crash, running receipts become interrupted; a new run requires inspection, particularly for physical effects. Queue max 32, default concurrency 2, step timeout 15 minutes, captured tail 100 KB. Configured environment values are redacted from captured output. Logs/output files and worktrees currently need operator retention/cleanup. Worker ownership marker prevents two servers using the same directory; after an unclean exit verify the process is dead before removing it.

## Workflow SDK host

In `saturn-saas` configure `SATURN_WORKER_URL`, `SATURN_WORKER_TOKEN`, existing `SESSION_SECRET`/GitHub OAuth and `CRON_SECRET`.

- `/api/jobs`: authenticated start/list/status, exact commit for deployment, bound applied build+period for reports.
- Separate `deployment.run` and `reports.run` capabilities; existing source editing/CI roles are not silently granted deployment. Each manual workflow dispatch/read step rechecks current repository access. Receipt is sealed to initiating user. Worker token never reaches the browser.
- `/api/schedules`: authenticated system cron starts `scheduledReports`; Vercel cron every minute is configured. Self-hosted scheduler can call the same endpoint once per minute with `Authorization: Bearer $CRON_SECRET`.
- Production self-hosting: installed `@workflow/world-postgres`; set `WORKFLOW_TARGET_WORLD=@workflow/world-postgres`, `WORKFLOW_POSTGRES_URL`, bootstrap according to the SDK. Local verification uses `WORKFLOW_TARGET_WORLD=local` and a temporary `WORKFLOW_LOCAL_DATA_DIR`. Local world is not a production HA claim.

SDK directives must be on their own lines because current discovery scans line patterns before AST transformation. `scripts/workflow-worker-test.ts` runs the built Nitro server and real local world to catch missing step registrations.

## Scheduled reports

```ts
report('hourly-water', {
  label: {ru:'Почасовой расход', en:'Hourly flow'},
  columns: {flow: column(flow, 'mean', 'Flow')},
  bucketMs: 60_000,
  schedule: [{cron:'0 * * * *', timeZone:'Europe/Moscow', periodMs:3_600_000}],
});
```

Schedules come from the **applied artifact**, not from an unsaved draft. UTC-minute slot + project + applied hash + report + schedule index deduplicates overlapping SDK invocations. IANA timezone controls cron matching; DST repeated local times are two different UTC slots. No downtime backfill is claimed. A queue failure remains visible and does not produce a fabricated report.

The same worker runs reports against the runtime archive, using the same `runReport`/`aggregateReport` as interactive reports. JSON and real CSV preserve nulls, freshness, semantic IDs and coverage. Limits remain 31 days/1000 buckets/50k observations per signal/200k total. Jobs, cron and JSON/CSV are restored here; old XLSX/render-target/full typed-schema parity remains open in capabilities.md.

## Comparing versions

Every new measured sample gets immutable `TelemetryRun`: UUID, exact applied build hash, source commit (nullable), execution mode and start time. Installed driver activation creates a run after durable commit. Orderly stop/adoption closes the previous run so its held values cannot extend past execution. Compatible acquisition adoption changes the run at the applied boundary without restarting the driver. Callback fencing remains intact. A quality-only event keeps the original measurement provenance. Old archive rows stay unassigned.

`/api/telemetry/runs` lists latest 100 runs; `/api/telemetry/compare` compares the same semantic numeric signal under each retained build's own freshness contract and matching units. Runs are aligned to elapsed time from start. UI adds current Git ref labels as navigation hints; build hashes identify the actual code, including a dirty working tree whose sourceDigest differs at the same Git commit.

A/B means, B−A and per-side coverage are returned. Nulls stay missing. This allows experiments across two source versions; it does not establish causation without matched operating conditions. Comparison is bounded to 1000 buckets and 50k observations per run. Automated performance gates, statistically matched scenarios and cross-server archive federation remain future work.

### Primary implementation references

- [Bun standalone executable / BUN_BE_BUN](https://bun.sh/docs/bundler/executables).
- [Workflow SDK PostgreSQL World](https://workflow-sdk.dev/worlds/postgres).
- [Native GitHub runner labels](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).

UI note (2026-09-25): the A/B comparison disclosure was removed from the graphs panel at the user’s request. Ordinary history remains; runtime comparison/provenance contracts are unchanged.
