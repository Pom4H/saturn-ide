import { expect, test } from "bun:test";
import { createApp } from "../src/server/index";
import type { IDEState } from "../src/protocol";
import type { SourceFile } from "../src/server/workspace";
import { fixture } from "./helpers";

test("bun server integration: project, telemetry, safe writes, diagnostics and last-good model", async () => {
  const f = fixture(), app = await createApp({ projectDir: f.root, dataDir: f.dir, databaseUrl: ":memory:", port: 0 });
  try {
    const base = app.server.url;
    const state = await fetch(new URL("api/state", base)).then(r => r.json()) as IDEState;
    expect(state.problems).toEqual([]); expect(state.mode).toBe("simulation");
    expect(state.snapshot.samples["pump.rpm"]?.value).toBe(1450);
    const post = (path: string, body: unknown, headers: Record<string,string> = {}) => fetch(new URL(`api/${path}`, base), { method: "POST", headers: { "Content-Type": "application/json", "X-Saturn-Key": state.key, ...headers }, body: JSON.stringify(body) });
    expect((await post("command", { signal: "pump.run", value: false }, { "X-Saturn-Key": "wrong" })).status).toBe(403);
    expect((await post("command", { signal: "pump.run", value: false }, { Origin: "https://evil.test" })).status).toBe(403);
    expect((await post("command", { signal: "pump.run", value: false })).status).toBe(200);
    await Bun.sleep(1200);
    expect(app.state().snapshot.samples["pump.run"]?.value).toBe(false);
    const file = app.workspace.read("project.ts");
    const saved = await (await post("file", { ...file, source: file.source.replace("x: 335", "x: 375") })).json() as { file: SourceFile; state: IDEState };
    expect(saved.state.problems).toEqual([]);
    expect(saved.state.project.equipment.find(e => e.id === "P-01")?.x).toBe(375);
    await Bun.sleep(1100);
    expect(app.state().snapshot.samples["pump.run"]?.value).toBe(false);
    const bad = await (await post("file", { ...saved.file, source: saved.file.source.replace("x: 375", 'x: "bad"') })).json() as { state: IDEState };
    expect(bad.state.problems.length).toBeGreaterThan(0);
    expect(bad.state.revision).toBe(saved.state.revision);
    expect(bad.state.project.equipment.find(e => e.id === "P-01")?.x).toBe(375);
    expect((await post("file", { ...file, source: file.source })).status).toBe(409);
    expect((await fetch(new URL("api/file?path=../package.json", base))).status).toBe(400);
  } finally { await app.close(); f.clean(); }
}, 60000);
