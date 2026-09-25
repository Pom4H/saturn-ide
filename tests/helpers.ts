import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { alarm, project, signal } from "../src/core";
export const appRoot = resolve(import.meta.dir, "..");
export function fixture() {
  mkdirSync(join(appRoot, ".saturn"), { recursive: true });
  const dir = mkdtempSync(join(appRoot, ".saturn", "test-")), root = join(dir, "project");
  cpSync(resolve(Bun.env.SATURN_EXAMPLE ?? join(appRoot, "../saturn-examples/pumping-station")), root, { recursive: true, filter: path => !path.split(/[\\/]/).some(part => part === "node_modules" || part === ".saturn") });
  return { dir, root, clean: () => rmSync(dir, { recursive: true, force: true }) };
}
export function model() {
  const pressure = signal("pressure", { initial: 0, min: 0, writable: true });
  const readOnly = signal("read-only", { initial: false });
  return project({ id: "test", label: "Test", signals: { pressure, readOnly }, equipment: [], pipes: [], alarms: [alarm("high", { label: { en: "High", ru: "Высокое" }, signal: pressure, above: 10, hysteresis: 2 })] });
}
