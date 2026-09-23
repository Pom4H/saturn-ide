import { mkdirSync, readFileSync, watch } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import html from "../ide/index.html";
import { text, validateProject, type Driver, type Problem, type Project } from "../core";
import type { IDEState } from "../protocol";
import { Workspace, HttpError, hash } from "./workspace";
import { Language } from "./language";
import { Store } from "./store";
import { Events } from "./events";
import { Runtime } from "./runtime";
import { Git } from "./git";
import { Push, validateSubscription } from "./push";

const appRoot = resolve(import.meta.dir, "../..");
const empty: Project = { id: "unloaded", label: { en: "Project not loaded", ru: "Проект не загружен" }, signals: {}, equipment: [], pipes: [], alarms: [] };
export async function createApp(options: { projectDir?: string; dataDir?: string; databaseUrl?: string; port?: number } = {}) {
  const workspace = new Workspace(options.projectDir ?? resolve(Bun.env.SATURN_PROJECT ?? "project"));
  const dataDir = options.dataDir ?? join(appRoot, ".saturn", hash(workspace.root).slice(0, 12));
  mkdirSync(dataDir, { recursive: true });
  const store = new Store(options.databaseUrl ?? Bun.env.DATABASE_URL ?? `sqlite://${join(dataDir, "history.sqlite")}`);
  await store.init();
  const events = new Events(), language = new Language(workspace, appRoot), git = new Git(workspace), push = new Push(store, dataDir);
  const key = crypto.randomUUID();
  let driver: Driver | undefined, stopDriver: (() => void) | undefined, driverHash = "", revision = "", attempted = "";
  let problems: Problem[] = [], positions: IDEState["positions"] = {}, initialized = false;
  const report = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    problems = [{ code: "RUNTIME", message: { en: message, ru: message } }];
    events.emit("project", state());
    console.error(message);
  };
  const runtime = new Runtime(empty, store, events, id => {
    const alarm = runtime.project.alarms.find(a => a.id === id);
    if (alarm) void push.send("Saturn", `${text(alarm.label, "ru")} / ${text(alarm.label, "en")}`).catch(report);
  });
  const state = (): IDEState => ({ project: runtime.project, positions, problems, revision, snapshot: runtime.snapshot, mode: driver?.mode ?? "offline", adapter: store.adapter, key, pushPublicKey: push.publicKey });
  const reloadNow = async () => {
    const files = workspace.list().filter(p => /\.tsx?$/.test(p));
    const digest = hash(files.map(p => `${p}\0${workspace.read(p).source}`).join("\0"));
    if (digest === attempted) return;
    attempted = digest;
    language.clear();
    problems = language.diagnostics();
    if (problems.length) { events.emit("project", state()); return; }
    try {
      const outdir = join(dataDir, "modules", digest);
      const entrypoints = [workspace.file("project.ts")];
      if (files.includes("server.ts")) entrypoints.push(workspace.file("server.ts"));
      const result = await Bun.build({ entrypoints, outdir, naming: "[name].mjs", target: "bun", plugins: [{ name: "core-import", setup(build) {
        build.onResolve({ filter: /^@saturn\/core$/ }, () => ({ path: join(appRoot, "src/core.ts") }));
      } }] });
      if (!result.success) throw new Error(result.logs.map(l => l.message).join("\n"));
      const candidate = (await import(pathToFileURL(join(outdir, "project.mjs")).href)).default as Project;
      validateProject(candidate);
      const serverOutput = result.outputs.find(o => o.path.endsWith("server.mjs"));
      const nextDriverHash = serverOutput ? hash(await serverOutput.text()) : "";
      const definitionsChanged = JSON.stringify(runtime.project.signals) !== JSON.stringify(candidate.signals);
      let nextDriver = driver;
      if (nextDriverHash !== driverHash || definitionsChanged || !initialized) {
        nextDriver = serverOutput ? (await import(pathToFileURL(join(outdir, "server.mjs")).href)).default as Driver : undefined;
        if (nextDriver && (!(nextDriver.mode === "live" || nextDriver.mode === "simulation") || typeof nextDriver.start !== "function")) throw new Error("server.ts must export a Driver");
      }
      const restart = nextDriverHash !== driverHash || definitionsChanged || !initialized;
      // Stop acquisition before replacing signal definitions, but never restart a driver for a layout edit.
      if (restart) { stopDriver?.(); stopDriver = undefined; driver = undefined; }
      await runtime.serial(async () => { runtime.apply(candidate); if (!initialized) await runtime.init(); });
      initialized = true;
      positions = workspace.positions(candidate.equipment.map(e => e.id));
      revision = digest;
      if (restart && nextDriver) {
        stopDriver = await nextDriver.start({ project: candidate, snapshot: runtime.snapshot, publish: values => runtime.ingest(values) });
        driver = nextDriver;
      }
      driverHash = nextDriverHash;
      problems = [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const localized = error && typeof error === "object" && "messages" in error ? error.messages as Problem["message"] : { en: message, ru: message };
      problems = [{ code: "PROJECT", message: localized }];
    }
    events.emit("project", state());
  };
  let reloadQueue: Promise<void> = Promise.resolve();
  const reload = () => { const result = reloadQueue.then(reloadNow); reloadQueue = result.catch(report); return result; };
  await reload();
  const background = setInterval(() => void runtime.stale().catch(report), 1000);
  const retention = setInterval(() => void store.prune().catch(report), 3600_000);
  await store.prune();
  let debounce: ReturnType<typeof setTimeout>;
  const watcher = watch(workspace.root, { recursive: true }, (_event, path) => {
    if (!path || !/\.tsx?$/.test(path) || path.split(/[\\/]/).some(p => p.startsWith(".") || p === "node_modules")) return;
    clearTimeout(debounce);
    debounce = setTimeout(() => void reload().catch(report), 200);
  });
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  const field = (body: Record<string, unknown>, name: string) => {
    const value = body[name];
    if (typeof value !== "string") throw new HttpError(400, `Expected string: ${name}`);
    return value;
  };
  const server = Bun.serve({
    hostname: "127.0.0.1", port: options.port ?? Number(Bun.env.PORT ?? 3000), idleTimeout: 0,
    development: { hmr: true, console: true }, maxRequestBodySize: 300_000,
    routes: { "/": html, "/hmi": html },
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new HttpError(403, "Untrusted host");
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) throw new HttpError(403, "Cross-origin request refused");
        const path = url.pathname;
        if (request.method === "GET") {
          if (path === "/api/state") return json(state());
          if (path === "/api/events") return events.response(request, state());
          if (path === "/api/files") return json(workspace.list());
          if (path === "/api/file") return json(workspace.read(url.searchParams.get("path") ?? "project.ts"));
          if (path === "/api/git") return json(await git.status());
          if (path === "/api/history") {
            const id = url.searchParams.get("signal") ?? "";
            if (!Object.values(runtime.project.signals).some(s => s.id === id)) throw new HttpError(404, "Unknown signal");
            return json(await store.history(id));
          }
          if (path === "/api/alarms") return json(await store.events());
          if (path === "/sw.js") return new Response(Bun.file(join(appRoot, "src/ide/sw.js")), { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" } });
          return json({ error: "Not found" }, 404);
        }
        if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
        if (request.headers.get("X-Saturn-Key") !== key || !request.headers.get("content-type")?.includes("application/json")) throw new HttpError(403, "Missing session key or JSON content type");
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "Expected an object");
        const b = body as Record<string, unknown>;
        if (path === "/api/file") {
          const file = workspace.save(field(b, "path"), field(b, "source"), field(b, "version"));
          await reload();
          return json({ file, state: state() });
        }
        if (path === "/api/language") {
          const file = field(b, "path"), source = field(b, "source"), operation = field(b, "operation");
          if (source.length > 256_000 || !/\.tsx?$/.test(file)) throw new HttpError(400, "Not a TypeScript source file");
          const position = Number(b.position ?? 0);
          if (!Number.isInteger(position) || position < 0 || position > source.length) throw new HttpError(400, "Invalid source position");
          language.clear();
          if (operation === "hover") return json(language.hover(file, source, position, b.locale === "en" ? "en" : "ru"));
          if (operation === "complete") return json(language.complete(file, source, position));
          if (operation === "diagnostics") return json(language.diagnostics(file, source));
          throw new HttpError(400, "Unknown language operation");
        }
        if (path === "/api/command") { await runtime.command(field(b, "signal"), b.value, driver); return json({ accepted: true }); }
        if (path === "/api/telemetry") {
          if (!b.values || typeof b.values !== "object" || Array.isArray(b.values)) throw new HttpError(400, "Expected signal values");
          await runtime.ingest(b.values as Record<string, unknown>); return json({ accepted: true });
        }
        if (path === "/api/ack") { await runtime.acknowledge(field(b, "id")); return json({ ok: true }); }
        if (path === "/api/git") { const result = await git.action(field(b, "action"), typeof b.message === "string" ? b.message : undefined); await reload(); return json(result); }
        if (path === "/api/push/subscribe") {
          const subscription = validateSubscription(b.subscription);
          const subscriptions = await store.subscriptions();
          if (subscriptions.length >= 100 && !subscriptions.some(s => s.endpoint === subscription.endpoint)) throw new HttpError(429, "Subscription limit reached");
          await store.subscribe(subscription); return json({ ok: true });
        }
        if (path === "/api/push/unsubscribe") { await store.unsubscribe(field(b, "endpoint")); return json({ ok: true }); }
        if (path === "/api/push/test") { await push.send("Saturn", "Push delivery test / Проверка доставки"); return json({ sent: true }); }
        throw new HttpError(404, "Not found");
      } catch (error) { return json({ error: error instanceof Error ? error.message : String(error) }, error instanceof HttpError ? error.status : 400); }
    },
  });
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    watcher.close(); clearTimeout(debounce); clearInterval(background); clearInterval(retention); stopDriver?.();
    await reloadQueue; await runtime.serial(async () => {});
    events.close(); await server.stop(true); language.dispose(); await store.close();
  };
  return { server, close, runtime, workspace, state, reload };
}
if (import.meta.main) {
  const app = await createApp();
  console.log(`Saturn IDE  ${app.server.url}\nProject     ${app.workspace.root}\nMode        ${app.state().mode}\nStorage     ${app.state().adapter}`);
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void app.close().then(() => process.exit(0)));
}
