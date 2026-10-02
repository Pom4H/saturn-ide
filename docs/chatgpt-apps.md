# Saturn in ChatGPT Apps

Status: the local MCP server and actual Apps UI are implemented and tested. An account-owned Secure MCP Tunnel and developer-mode connection are still required. This is not a published directory listing, OAuth rollout, or evidence of a live ChatGPT account connection.

Saturn keeps one authored TypeScript project. Apps embeds the existing Shell, SVG/Three.js equipment, source editor, HMI, history and reports. The host adapter forwards the existing APIs; it does not create a second project model or an agent harness. The app shares its current URL and selection with ChatGPT. Navigation also works when the host loads an immutable `about:srcdoc` resource; it does not require permission to change that iframe URL. ChatGPT/Codex owns the conversation.

## Run the local project

From the IDE repository, keep the existing workspace running:

```sh
SATURN_PROJECT=/absolute/path/to/project SATURN_PREVIEW=simulation PORT=3000 bun dev
```

Use `SATURN_PREVIEW=manual` to disable automatic simulator preview. Saving never automatically applies to a live driver. Start the separate Apps adapter with the **same authored project directory**, so its project-owned browser extensions are bundled:

```sh
SATURN_PROJECT=/absolute/path/to/project SATURN_WORKSPACE_URL=http://127.0.0.1:3000 bun run apps
```

The default MCP endpoint is `http://127.0.0.1:3100/mcp`. `SATURN_APPS_PORT` changes the port. `GET /health` reports the endpoint's workspace and versioned UI resource. The server binds only to loopback and rejects foreign origins/hosts. It exposes stateless Streamable HTTP POST, with the official MCP SDK and MCP Apps resource metadata. It has no model API dependency.

## Connect through Secure MCP Tunnel

1. Create a tunnel in [Platform → Tunnels](https://platform.openai.com/settings/organization/tunnels) and associate it with the intended ChatGPT workspace. Retain its `tunnel_id`. The tunnel operator needs the documented Tunnels permissions.
2. Install the official `tunnel-client` from the Platform download link or the current [OpenAI release](https://github.com/openai/tunnel-client/releases/latest). On this development Mac, a SHA256-verified v0.0.15 binary was placed in `.saturn/tools/tunnel-client`; this ignored local file is not part of the plugin package.
3. Set `CONTROL_PLANE_API_KEY` in the local terminal through your secret-management workflow. The runtime key belongs in the environment, never in chat, the plugin manifest or Git.
4. Run the managed official tunnel runtime:

```sh
bun run apps:tunnel tunnel_YOUR_ID
```

The script points the tunnel at the loopback MCP endpoint and prints official runtime status. Verify **process_running, healthy and ready** before claiming connection. `SATURN_MCP_URL` can change the loopback endpoint.

5. In ChatGPT developer mode, open [Plugins](https://chatgpt.com/plugins), create the connection and choose **Tunnel**. Select the tunnel or paste its ID, then discover the Saturn tools and open the UI with `saturn_open`.

The official [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) describes account/workspace prerequisites and troubleshooting. The tunnel is transport; this local adapter has no per-user OAuth or audit boundary. Access to it grants access to this trusted local project, including separately annotated runtime tools. Keep it private. Public or multi-user deployment requires the [documented authentication contract](https://developers.openai.com/plugins/build/auth).

## Portable plugin package

`.agents/plugins/saturn/` contains `plugin.json`, local `mcp.json`, an engineering skill and icon. `.agents/plugins/marketplace.json` exposes it as **Saturn local development** for local desktop testing. The loopback MCP entry is for a host on this Mac; ChatGPT web uses the registered tunnel connection.

After creating the real connection, take its technical `plugin_asdk_app…` ID from its URL and run:

```sh
bun run apps:register plugin_asdk_appYOUR_ID
```

This writes `.app.json` and links it through `extensions.com.openai.apps`. No placeholder ID is installed. Reload/reinstall the local plugin copy if the host cached an earlier package. Packaging follows the [portable plugin contract](https://developers.openai.com/plugins/build/plugins). Directory publication/review remains a separate step.

**This mapping is for local/workspace testing.** The current public submission flow
rejects `apps`/`.app.json` references and lifecycle hooks. A public distribution
package must declare its remote MCP in `mcp.json`, without the local mapping.
The normal public route requires HTTPS; local-only distribution needs a separate
agreement with OpenAI. Secure MCP Tunnel connection is not evidence of public
directory eligibility. See [package distribution](https://developers.openai.com/plugins/build/plugins)
and [submission restrictions](https://developers.openai.com/plugins/deploy/submission#automatically-provide-submission-and-review-information).

## Extension flexibility audit — 2026-10-02

The [ChatGPT plugin overview](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
describes an assistant integration package, while Saturn project extensions are
authored engineering source. They have different owners and do not replace one another.
There is no evidence for a blanket claim that Saturn is equally flexible or better.

| Capability | Current Saturn implementation and evidence | Remaining limit |
| --- | --- | --- |
| Project ownership and modification | Copied source, normal imports, Git provenance, revision CAS and local-edit protection (`workspace/plugins.ts`, `tests/plugins.test.ts`) | Trusted source; no sandbox for arbitrary third-party code |
| New equipment and signals | `device()` retains typed ports, dimensions/default signals and canonical Project indexing; actual custom equipment source builds (`tests/project-authoring.test.ts`, `tests/generated-device-types.test.ts`) | Complete custom renderers/targets acceptance remains partial; `Scene3DCapability` still has a specific control-panel shape |
| Protocols, importers and monitoring | Project driver modules, explicit browser importers, typed monitoring declarations (`tests/importer-extension.test.ts`, `tests/monitoring-extension.test.ts`) | No automatic directory activation; explicit imports intentionally required |
| Full Shell replacement | Shared navigation/URL state and renderer capabilities exist | Public views/commands/settings contribution SDK, replace/fork/update workflow are a design in `shell-extension-design.md`, not implemented |
| Assistant tools, skills and interactive views | Portable manifest + engineering skill + MCP, actual Shell in official AppBridge, global/thread entrypoints, model context and exact port links (`tests/apps.test.ts`, browser recording) | Actual ChatGPT account, installed package and Tunnel still untested |
| ChatGPT surface extensions | Existing `saturn_open` routes and context carry project resources | Composer resource search/mentions, host file handlers, structured plugin settings and rich forms are not declared; URLs alone do not implement those protocols |
| Events and assistant automations | UI receives bounded/coalesced existing workspace events | UI event polling is not ChatGPT event subscriptions; no host event-trigger integration |
| Distribution and permissions | Local marketplace package; project-copy update checks | No Saturn marketplace/admin roles or per-user Apps OAuth/audit. ChatGPT owns its plugin lifecycle and approvals; duplicating an agent harness is unnecessary |

OpenAI documents the additional surface protocols in
[Plugin Extensions](https://developers.openai.com/plugins/build/extensions). The next
Shell extension work must preserve existing views, ports, runtime identity fences,
reports and acceptance criteria; it must not introduce a hidden installation database
or a second Project model. Engineering expressiveness is a Saturn strength; general
plugin lifecycle parity has not been demonstrated.

## Public plugin submission readiness

Run these read-only subset checks against a package directory:

```sh
bun run apps:validate
bun run apps:validate:public
```

The public check deliberately exits nonzero for the current local package. It checks
selected manifest limits, SVG size, asset confinement, remote URL shape, forbidden
local app mappings/hooks, required listing pages and review materials. It does not
replace official schema/ZIP validation, scan secrets, contact URLs, verify DNS/auth,
prove test-case execution or guarantee approval. `unchecked` lists external gates.

Prepared review cases in `plugin.json` cover project/status, exact 3D port navigation,
source editing, custom equipment insertion and report coverage, plus inspection-only,
path traversal and stale-save failures. These are **review drafts**, not evidence of
five positive and three negative prompts passed by a model in a real ChatGPT account.

Before submission, provide a stable reviewer-accessible HTTPS service and confirmed
domain; real publisher website/support/privacy/terms pages; a verified publishing
identity and submission permissions; authenticated per-user project access for
non-public source/control; test-account runs on desktop and mobile; an accessible
walkthrough. Keep credentials in the portal rather than the package. The loopback
host is not suitable for public forwarding without that authorization boundary.

The server also needs review of model-facing `saturn_read` and `saturn_preview`:
they select bounded existing APIs by path, whereas the current
[tool guidelines](https://developers.openai.com/plugins/plugin-guidelines#tool-independence-and-exposure)
require individually exposed model operations. App-only UI transports must stay
app-only. Source overwrite annotations now declare `destructiveHint:true`; additive
file creation remains false. Annotations never implement authorization.

Submit the completed package through [Platform Plugins](https://platform.openai.com/plugins),
resolve official scans, then request review and publish only after approval. A published
Saturn-authored plugin is distinct from the **OpenAI Verified** program; that badge
requires OpenAI's separate selected-developer review. No public draft was uploaded,
no review requested and no plugin published during this audit.

## Tools and identity boundaries

- `saturn_project`: resource catalog, problems, mode and distinct Checked/Published/Applied identities.
- `saturn_open`: actual UI and local link; supports surfaces, source files, devices/connections, ports, signals, reports, camera/viewBox and settings. Port targets are checked against the current authored model.
- `saturn_read_source`, `saturn_save_sources`, `saturn_create_source`: normal workspace files. Existing files require exact version CAS; new files cannot overwrite. Errors in saved TS are returned as project diagnostics.
- `saturn_create_device`: source/import preview followed by explicit `apply:true` with `projectVersion`; omitted XY uses logical non-overlapping placement.
- `saturn_preview`, `saturn_check`, `saturn_read`: existing typed authoring/language/deployment preview and project/runtime APIs.
- `saturn_publish`, `saturn_apply`, `saturn_command`: separate explicit runtime actions, with expected identity fences and destructive/open-world annotations. Driver configuration recovery does not undo physical effects.

App-only transport tools carry full UI data and bounded updates in `_meta`, with `visibility:["app"]`. Session credentials are removed from state/release responses; authored report column keys remain intact. Telemetry is coalesced, the backlog is bounded, and a new/lagging client gets a fresh snapshot. The app keeps local frame animation continuous between received observations; tunnel latency still affects telemetry freshness.

The bundle uses the actual project browser entry, without nested network frames or direct localhost API fetches inside ChatGPT. HMI uses the same extracted component in standalone and embedded views. Typed HTML reports render in a scoped DOM; persisted XLSX/HTML downloads travel through an app-only tool, limited to 16 MiB. Web Push requires the standalone browser origin; Apps gives a link to it. External firmware/toolchains retain their existing limitations.

## Hot reload and verification limits

Saving authored source uses existing build/events and simulator policy. The Apps view remains mounted; camera and canvas persist. 3D device resources are managed per device: adding equipment preserves unchanged meshes, display drivers and animation phases. Changing a definition rebuilds that device and preserves its phase; changing an HMI context rebinds the affected display while retaining unrelated equipment; pose-only edits retain meshes. Logical group backgrounds update with their layout.

A change to the IDE/browser implementation or a project's `browser.ts` requires rebuilding the Apps host and reopening the versioned UI resource. This integration does not claim hot-swapping arbitrary JavaScript already executing in a ChatGPT iframe. The adapter is a separate process; the existing dev workspace still composes runtime in one process.

Run `bun run check`, `bun test tests`, and `bun run test:apps:browser`. The browser acceptance host uses the **official AppBridge** using an actual `srcdoc` resource with CSP blocking direct connections and nested frames, not a custom agent harness. Its recording/reference frames cover normal, edited, failed-source, disconnected and closed states. This proves the local MCP/Apps contract; account permissions, real tunnel throughput, ChatGPT sandbox policies and public directory review require actual account testing. Exact executed results are in [verification.md](verification.md).
