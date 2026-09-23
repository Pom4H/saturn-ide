import { expect, test } from "bun:test";
import { writeFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { Workspace } from "../src/server/workspace";
import { moveSource } from "../src/source-edits";
import { fixture } from "./helpers";
import { scaffold } from "../scripts/scaffold";

test("drag changes only numeric AST ranges, preserving comments and formatting", () => {
  const f = fixture();
  try {
    const source = '// x: 666 is a comment\nconst p = pump("p", { x: -4, /* position */ y: 30, label: "x: 9" });\n';
    writeFileSync(join(f.root, "edit.ts"), source);
    const w = new Workspace(f.root), p = w.positions(["p"])["p"]!;
    expect(p).toBeDefined();
    const moved = moveSource(source, p, 23, 90);
    expect(moved).toBe(source.replace("x: -4", "x: 23").replace("y: 30", "y: 90"));
    const file = w.save("edit.ts", moved, p.version);
    expect(() => w.save("edit.ts", source, p.version)).toThrow("changed on disk");
    expect(w.read("edit.ts").version).toBe(file.version);
    writeFileSync(join(f.root, "computed.ts"), 'const p = pump("computed", {x: 5 * scale, y: 10});');
    expect(w.positions(["computed"])["computed"]).toBeUndefined();
  } finally { f.clean(); }
});
test("filesystem confinement rejects traversal, secrets and escaping symlinks", () => {
  const f = fixture();
  try {
    const w = new Workspace(f.root);
    writeFileSync(join(f.dir, "outside.ts"), "secret");
    symlinkSync(join(f.dir, "outside.ts"), join(f.root, "escape.ts"));
    for (const path of ["../outside.ts", ".env", "escape.ts", "../project/project.ts", "project.ts/.."]) expect(() => w.read(path)).toThrow();
    expect(w.list()).not.toContain("escape.ts");
  } finally { f.clean(); }
});
test("scaffolding copies files without overwriting or registering plugins", () => {
  const f = fixture();
  try {
    scaffold("plc", "plc-01", f.root); scaffold("plugin", "sensor", f.root);
    const w = new Workspace(f.root);
    expect(w.list()).toContain("equipment/plc-01/compiler.ts");
    expect(w.list()).toContain("equipment/plc-01/hmi.ts");
    expect(w.list()).toContain("plugins/sensor/index.ts");
    expect(() => scaffold("plc", "plc-01", f.root)).toThrow("Already exists");
    expect(() => scaffold("plc", "../bad", f.root)).toThrow();
  } finally { f.clean(); }
});
