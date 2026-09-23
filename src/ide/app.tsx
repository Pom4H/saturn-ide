import { StrictMode, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import { text, type Equipment, type Locale, type Sample, type Signal, type Snapshot, type Value } from "../core";
import type { IDEState } from "../protocol";
import type { SourceFile } from "../server/workspace";
import type { AlarmEvent } from "../server/store";
import type { Git } from "../server/git";
import { moveSource, type PositionSource } from "../source-edits";
import { api, setKey } from "./api";
import { copy } from "./i18n";
import { Editor } from "./editor";
import { Scene } from "./scene";

type GitState = Awaited<ReturnType<Git["status"]>>;
type Dock = "signals" | "alarms" | "history" | "git";
const format = (value: Value) => typeof value === "number" ? Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value) : String(value);
const time = (at: number) => at ? new Date(at).toLocaleTimeString() : "—";
function Control({ signal, sample, locale, command }: { signal: Signal; sample?: Sample; locale: Locale; command: (id: string, value: Value) => void }) {
  const [value, setValue] = useState(String(sample?.value ?? signal.initial));
  useEffect(() => setValue(String(sample?.value ?? signal.initial)), [signal.id, sample?.value]);
  const c = copy[locale];
  if (!signal.writable) return null;
  if (typeof signal.initial === "boolean") return <button className={sample?.value ? "stop" : "primary"} onClick={() => command(signal.id, !sample?.value)}>{sample?.value ? c.stop : c.start}</button>;
  return <form className="command" onSubmit={event => { event.preventDefault(); command(signal.id, typeof signal.initial === "number" ? Number(value) : value); }}>
    <input aria-label={signal.id} type={typeof signal.initial === "number" ? "number" : "text"} min={signal.min} max={signal.max} step="any" value={value} onChange={event => setValue(event.target.value)}/>
    <span>{signal.unit}</span><button type="submit">{c.send}</button>
  </form>;
}
function History({ project, locale, selected }: { project: IDEState["project"]; locale: Locale; selected: string }) {
  const [id, setId] = useState(selected), [samples, setSamples] = useState<Sample[]>([]), [error, setError] = useState("");
  useEffect(() => { const abort = new AbortController(); api<Sample[]>(`history?signal=${encodeURIComponent(id)}`, undefined, abort.signal).then(setSamples).catch(e => { if (!abort.signal.aborted) setError(String(e)); }); return () => abort.abort(); }, [id]);
  const points = samples.filter((s): s is Sample & { value: number } => typeof s.value === "number" && s.quality === "good");
  const min = Math.min(...points.map(s => s.value)), max = Math.max(...points.map(s => s.value)), t0 = points[0]?.at ?? 0, t1 = points.at(-1)?.at ?? 1;
  const path = points.map(s => `${24+(s.at-t0)/Math.max(1,t1-t0)*910},${100-(s.value-min)/Math.max(.01,max-min)*80}`).join(" ");
  return <div className="history-pane"><div className="inline"><select aria-label={copy[locale].signal} value={id} onChange={e => setId(e.target.value)}>{Object.values(project.signals).map(s => <option key={s.id}>{s.id}</option>)}</select><span className="muted">{samples.length} {copy[locale].samples}</span></div>
    {error ? <p role="alert">{error}</p> : points.length ? <><svg className="trend" viewBox="0 0 970 130" preserveAspectRatio="none" aria-label={`${id}: ${min}–${max}`}><path d="M24 12V106H950" fill="none" stroke="var(--border)"/><polyline points={path} fill="none" stroke="var(--accent)" strokeWidth={2} vectorEffect="non-scaling-stroke"/><text x={24} y={125}>{time(t0)}</text><text x={930} y={125} textAnchor="end">{time(t1)}</text></svg><span className="muted">{format(min)} — {format(max)} {Object.values(project.signals).find(s => s.id === id)?.unit}</span></> : <p className="muted">{copy[locale].emptyHistory}</p>}
  </div>;
}
function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem("saturn.locale") === "en" ? "en" : "ru");
  const c = copy[locale];
  const [state, setState] = useState<IDEState | null>(null), [connected, setConnected] = useState(false);
  const [file, setFile] = useState<SourceFile | null>(null), [source, setSource] = useState(""), [files, setFiles] = useState<string[]>([]);
  const [selected, setSelected] = useState("P-01"), [dock, setDock] = useState<Dock>("signals");
  const [showCode, setShowCode] = useState(window.innerWidth >= 1150), [operator, setOperator] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [saving, setSaving] = useState(false);
  const [git, setGit] = useState<GitState | null>(null), [message, setMessage] = useState("");
  const [audit, setAudit] = useState<AlarmEvent[]>([]), [historySignal, setHistorySignal] = useState("station.pressure");
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null), [dragging, setDragging] = useState(false);
  const drag = useRef<{ source: string; file: SourceFile; position: PositionSource } | null>(null);
  const current = useRef({ file, source, state, saving, dragging }); current.current = { file, source, state, saving, dragging };
  const dirty = file !== null && source !== file.source;
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
  const receive = useCallback((next: IDEState) => { setKey(next.key); setState(next); }, []);
  const refreshGit = () => api<GitState>("git").then(setGit).catch(fail);
  useEffect(() => {
    let disposed = false;
    Promise.all([api<IDEState>("state"), api<SourceFile>("file?path=project.ts"), api<string[]>("files")]).then(([next, file, files]) => {
      if (disposed) return; receive(next); setFile(file); setSource(file.source); setFiles(files);
    }).catch(fail);
    void refreshGit();
    const events = new EventSource("/api/events");
    events.onopen = () => setConnected(true);
    events.onerror = () => setConnected(false);
    events.addEventListener("snapshot", event => receive(JSON.parse((event as MessageEvent).data)));
    events.addEventListener("project", event => {
      receive(JSON.parse((event as MessageEvent).data));
      void api<string[]>("files").then(setFiles).catch(fail);
      const currentFile = current.current.file;
      if (currentFile && current.current.source === currentFile.source && !current.current.dragging && !current.current.saving) {
        void api<SourceFile>(`file?path=${encodeURIComponent(currentFile.path)}`).then(next => {
          if (current.current.file?.path === next.path && current.current.source === current.current.file.source && !current.current.dragging) { setFile(next); setSource(next.source); }
        }).catch(fail);
      }
    });
    events.addEventListener("telemetry", event => setState(s => s ? { ...s, snapshot: JSON.parse((event as MessageEvent).data) } : s));
    events.addEventListener("alarm", () => void api<AlarmEvent[]>("alarms").then(setAudit).catch(fail));
    return () => { disposed = true; events.close(); };
  }, [receive]);
  useEffect(() => { localStorage.setItem("saturn.locale", locale); document.documentElement.lang = locale; }, [locale]);
  useEffect(() => { const listener = (event: BeforeUnloadEvent) => { if (dirty) event.preventDefault(); }; window.addEventListener("beforeunload", listener); return () => window.removeEventListener("beforeunload", listener); }, [dirty]);
  const open = async (path: string, force = false) => {
    if (current.current.source !== current.current.file?.source && !force) { setError(c.discardFirst); return; }
    try { const next = await api<SourceFile>(`file?path=${encodeURIComponent(path)}`); setFile(next); setSource(next.source); setError(""); } catch (e) { fail(e); }
  };
  const save = async (nextSource?: string, expected?: SourceFile) => {
    const target = expected ?? current.current.file;
    if (!target || current.current.saving) return;
    const submitted = nextSource ?? current.current.source;
    current.current.saving = true; setSaving(true); setError("");
    try {
      const result = await api<{ file: SourceFile; state: IDEState }>("file", { path: target.path, source: submitted, version: target.version });
      if (current.current.file?.path === target.path) { setFile(result.file); if (current.current.source === submitted) setSource(result.file.source); }
      receive(result.state); void refreshGit();
    } catch (e) { fail(e); } finally { current.current.saving = false; setSaving(false); }
  };
  const begin = (id: string) => {
    const p = current.current.state?.positions[id], f = current.current.file;
    if (operator || saving) return false;
    if (dirty) { setError(c.discardFirst); return false; }
    if (!p || !f || p.version !== f.version && p.path === f.path) { setError(c.noLiteral); return false; }
    if (p.path !== f.path) { setError(c.sourceFirst); void open(p.path); return false; }
    drag.current = { source: f.source, file: f, position: p }; setDragging(true); return true;
  };
  const move = (id: string, x: number, y: number) => {
    if (!drag.current) return;
    setPreview({ id, x, y });
    const next = moveSource(drag.current.source, drag.current.position, x, y);
    current.current.source = next;
    setSource(next);
  };
  const end = (cancel: boolean) => {
    const edit = drag.current; drag.current = null; setDragging(false); setPreview(null);
    if (!edit) return;
    if (cancel) setSource(edit.source); else void save(current.current.source, edit.file);
  };
  const command = (id: string, value: Value) => {
    setError(""); void api("command", { signal: id, value }).then(() => setNotice(c.commandAccepted)).catch(fail);
  };
  const notify = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) throw new Error(c.noPush);
      if (await Notification.requestPermission() !== "granted") throw new Error(c.denied);
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const raw = state!.pushPublicKey.replace(/-/g, "+").replace(/_/g, "/");
      const applicationServerKey = Uint8Array.from(atob(raw + "=".repeat((4-raw.length%4)%4)), c => c.charCodeAt(0)).buffer;
      const subscription = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await api("push/subscribe", { subscription: subscription.toJSON() }); setNotice(c.pushEnabled);
    } catch (e) { fail(e); }
  };
  const gitAction = (action: string) => { setError(""); void api<GitState>("git", { action, message }).then(next => { setGit(next); setMessage(""); }).catch(fail); };
  if (!state || !file) return <main className="loading"><h1>Saturn IDE</h1><p>{error || c.reconnect}</p></main>;
  const snapshot: Snapshot = connected ? state.snapshot : { ...state.snapshot, samples: Object.fromEntries(Object.entries(state.snapshot.samples).map(([id, s]) => [id, { ...s, quality: "stale" as const }])) };
  const equipment = state.project.equipment.find(e => e.id === selected);
  const control = equipment?.kind === "pump" ? equipment.run : equipment?.kind === "valve" ? equipment.opening : undefined;
  const active = Object.values(snapshot.alarms).filter(a => a.active);
  const sceneProps = { project: state.project, snapshot, locale, selected, select: setSelected };
  if (location.pathname === "/hmi") {
    const ids = state.project.hmi?.equipment.map(e => e.id);
    const devices = state.project.equipment.filter(e => !ids || ids.includes(e.id));
    const index = Math.max(0, devices.findIndex(e => e.id === selected));
    const shown = devices[index];
    const hmiControl = shown?.kind === "pump" ? shown.run : shown?.kind === "valve" ? shown.opening : undefined;
    return <main className="hmi"><header><strong>{devices[index]?.id ?? "HMI"}</strong><span className={connected ? "status good" : "status stale"}>{connected ? c[state.mode] : c.disconnected}</span></header>
      <Scene {...sceneProps} focus={devices[index]?.id}/><footer><button disabled={devices.length < 2} onClick={() => setSelected(devices[(index+devices.length-1)%devices.length]!.id)} aria-label="Previous">←</button>
        {hmiControl && connected && <Control signal={hmiControl} sample={snapshot.samples[hmiControl.id]} locale={locale} command={command}/>}
        <button disabled={devices.length < 2} onClick={() => setSelected(devices[(index+1)%devices.length]!.id)} aria-label="Next">→</button></footer>{error && <div role="alert">{error}</div>}</main>;
  }
  return <div className={`app ${operator ? "operator-mode" : ""}`}>
    <header className="topbar"><div className="brand"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx={16} cy={16} r={9}/><ellipse cx={16} cy={16} rx={15} ry={5} transform="rotate(-25 16 16)"/></svg><strong>Saturn</strong><span>IDE</span></div>
      <span className="project-title">{text(state.project.label, locale)}</span><span className={`status ${state.mode === "simulation" ? "simulation" : state.mode === "live" ? "good" : "stale"}`}>{c[state.mode]}</span>
      <div className="top-actions"><button onClick={() => { if (dirty) { setError(c.discardFirst); return; } setOperator(!operator); }}>{operator ? c.engineering : c.operator}</button><button className="icon-button" onClick={() => void notify()} title={c.notifications} aria-label={c.notifications}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg></button><select aria-label="Language" value={locale} onChange={e => setLocale(e.target.value as Locale)}><option value="ru">RU</option><option value="en">EN</option></select></div>
    </header>
    {(error || notice) && <div className={error ? "message error" : "message"} role={error ? "alert" : "status"}><span>{error || notice}</span><button aria-label="Close" onClick={() => { setError(""); setNotice(""); }}>×</button></div>}
    {state.problems.length > 0 && <div className="problems"><strong>{c.errors}</strong>{state.problems.map((p,i) => <div key={i}>{p.code} {p.path}: {p.message[locale]}</div>)}</div>}
    <div className="workspace">
      {!operator && <aside className="sidebar"><h2>{c.project}</h2><div className="filetree">{files.map(path => <button key={path} className={file.path === path ? "file active" : "file"} onClick={() => void open(path)} title={path}><span className="file-type">{path.endsWith("ts") ? "TS" : path.endsWith("tsx") ? "TSX" : "·"}</span><span>{path}</span></button>)}</div><div className="sidebar-bottom"><span className="branch">⑂ {git?.branch || "—"}</span><span className="muted">{state.adapter === "sqlite" ? "SQLite" : "PostgreSQL"}</span></div></aside>}
      <main className="workbench">
        <div className="workbar"><div className="view-switch"><span className="active">{c.diagram}</span>{!operator && <button aria-pressed={showCode} onClick={() => setShowCode(!showCode)}>{c.code}</button>}</div><span className="muted hint">{operator ? `${state.project.equipment.length} · ${Object.keys(state.project.signals).length} ${c.signals.toLowerCase()}` : c.drag}</span><a href="/hmi" target="_blank" rel="noreferrer">{c.hmi} ↗</a></div>
        <div className={`canvas-row ${showCode && !operator ? "with-code" : ""}`}>
          {showCode && !operator && <section className="code-pane"><div className="pane-title"><span>{file.path}</span><span className={dirty ? "modified" : "muted"}>{dirty ? "●" : ""}</span><button onClick={() => void save()} disabled={!dirty || saving || dragging}>{saving ? "…" : c.save}</button></div><Editor path={file.path} source={source} locale={locale} change={setSource} save={() => void save()} dragging={dragging}/></section>}
          <section className="diagram-pane"><Scene {...sceneProps} preview={preview} begin={operator ? undefined : begin} move={move} end={end}/>
            <div className="selection-bar">{equipment ? <><div><strong>{equipment.id}</strong><span className="muted">{text(equipment.label, locale)}</span></div>{control && connected && <Control signal={control} sample={snapshot.samples[control.id]} locale={locale} command={command}/>}<div className="selection-actions">{!operator && state.positions[equipment.id] && <button onClick={() => { setShowCode(true); void open(state.positions[equipment.id]!.path); }}>{c.source} ↗</button>}</div></> : <span className="muted">{c.select}</span>}</div>
          </section>
        </div>
        <section className="dock"><nav>{(["signals","alarms","history","git"] as const).filter(tab => !operator || tab !== "git").map(tab => <button className={dock === tab ? "active" : ""} key={tab} onClick={() => { setDock(tab); if (tab === "git") void refreshGit(); if (tab === "alarms") void api<AlarmEvent[]>("alarms").then(setAudit).catch(fail); }}>{c[tab]}{tab === "alarms" && active.length > 0 && <span className="count">{active.length}</span>}</button>)}</nav>
          <div className="dock-content">
            {dock === "signals" && <table><thead><tr><th>{c.signal}</th><th>{c.value}</th><th>{c.quality}</th><th>{c.time}</th></tr></thead><tbody>{Object.values(state.project.signals).map(s => { const sample = snapshot.samples[s.id]; return <tr key={s.id} onClick={() => { setHistorySignal(s.id); setDock("history"); }}><td className="mono">{s.id}</td><td className="value">{sample?.quality === "good" ? format(sample.value) : "—"}<span className="muted unit">{s.unit}</span></td><td><span className={`quality ${sample?.quality ?? "stale"}`}>{c[sample?.quality ?? "stale"]}</span></td><td className="muted mono">{time(sample?.at ?? 0)}</td></tr>; })}</tbody></table>}
            {dock === "history" && <History key={historySignal} project={state.project} locale={locale} selected={historySignal}/>}
            {dock === "alarms" && <div className="alarm-pane">{!active.length && <p className="muted">{c.noAlarms}</p>}{active.map(a => <div className="alarm-row" key={a.id}><span className="alarm-dot"/><strong>{text(state.project.alarms.find(rule => rule.id === a.id)?.label ?? a.id, locale)}</strong><span className="muted">{time(a.at)}</span>{a.acknowledged ? <span>{c.acknowledged}</span> : <button onClick={() => void api("ack", { id: a.id }).catch(fail)}>{c.ack}</button>}</div>)}{audit.length > 0 && <div className="audit">{audit.slice(0,12).map((e,i) => <div key={i}><span>{time(e.at)}</span><code>{e.id}</code><span>{e.event === "ack" ? c.acknowledged : e.event === "clear" ? c.clear : c.active}</span></div>)}</div>}</div>}
            {dock === "git" && <div className="git-pane">{git?.available ? <><div className="git-controls"><input aria-label={c.commitMessage} placeholder={c.commitMessage} value={message} onChange={e => setMessage(e.target.value)}/><button onClick={() => gitAction("commit")} disabled={!message.trim() || !git.status.trim() || dirty}>{c.commit}</button>{git.remotes && <><button onClick={() => gitAction("pull")}>Pull</button><button onClick={() => gitAction("push")}>Push</button></>}</div><div className="git-columns"><pre>{git.status || c.clean}{git.diff ? `\n${git.diff}` : ""}</pre><pre className="muted">{git.log}</pre></div></> : <button onClick={() => gitAction("init")}>{c.init}</button>}</div>}
          </div>
        </section>
      </main>
    </div>
    <footer className="statusbar"><span className={connected ? "connected" : "disconnected"}>{connected ? c.connected : c.disconnected}</span><span>{dirty ? c.unsaved : c.saved}{dirty && <button onClick={() => { if (confirm(locale === "ru" ? "Отбросить несохранённый текст?" : "Discard unsaved text?")) void open(file.path, true); }}>{c.reset}</button>}</span><span className="revision">{state.revision.slice(0,8)}</span></footer>
  </div>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><App/></StrictMode>);
