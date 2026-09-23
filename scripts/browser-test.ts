import { chromium, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fixture } from "../tests/helpers";
import { execute } from "../src/server/git";
import type { IDEState } from "../src/protocol";

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const f = fixture(), port = 4017, base = `http://127.0.0.1:${port}`;
mkdirSync("artifacts", { recursive: true });
await execute(["git", "init", "-b", "main"], f.root);
await execute(["git", "config", "user.name", "Saturn browser test"], f.root);
await execute(["git", "config", "user.email", "test@localhost"], f.root);
await execute(["git", "add", "."], f.root);
await execute(["git", "commit", "-m", "Initial fixture"], f.root);
const process = Bun.spawn(["bun", "dev"], { env: { ...Bun.env, SATURN_PROJECT: f.root, PORT: String(port), DATABASE_URL: ":memory:" }, stdout: "pipe", stderr: "pipe" });
const stdout = new Response(process.stdout).text(), stderr = new Response(process.stderr).text();
const checks: string[] = [], errors: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
const state = async () => await (await fetch(`${base}/api/state`)).json() as IDEState;
async function until(check: () => Promise<boolean>, message: string) { for (let i=0;i<80;i++) { if (await check().catch(() => false)) return; await Bun.sleep(250); } throw new Error(message); }
async function hoverPump(page: Page) {
  const line = page.locator(".cm-line").filter({ hasText: "const booster = pump" });
  await line.scrollIntoViewIfNeeded();
  const point = await line.evaluate(element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const from = node.textContent?.indexOf("pump") ?? -1;
      if (from >= 0) { const range = document.createRange(); range.setStart(node, from); range.setEnd(node, from+4); const box=range.getBoundingClientRect(); return { x: box.x+box.width/2, y: box.y+box.height/2 }; }
    }
    return null;
  });
  assert(point, "pump token was not rendered in the editor");
  await page.mouse.move(point.x, point.y);
  await page.locator(".jsdoc").waitFor({ state: "visible", timeout: 15000 });
}
try {
  await until(async () => (await fetch(`${base}/api/state`)).ok, "bun dev did not start");
  const initial = await state();
  assert(initial.problems.length === 0, JSON.stringify(initial.problems));
  assert(initial.mode === "simulation", "Demo must be explicitly marked as simulation");
  checks.push("bun dev serves the actual IDE and simulated SCADA");
  browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(base);
  await page.locator('[data-equipment="P-01"] [data-part="rotor"][data-rpm="1450"]').waitFor({ timeout: 30000 });
  assert(await page.locator('[data-anatomy="saturn-pump"] circle').count() >= 10, "Original pump detail was lost");
  checks.push("original SVG anatomy is used in the live view");
  const pipe = page.locator('[data-pipe="suction"] path').first(), oldPath = await pipe.getAttribute("d");
  const pump = page.locator('[data-equipment="P-01"]'), box = await pump.boundingBox();
  assert(box, "pump is not visible");
  await page.mouse.move(box.x+box.width/2, box.y+box.height/2); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+40, box.y+box.height/2-15, { steps: 6 }); await page.waitForTimeout(150);
  assert(await pipe.getAttribute("d") !== oldPath, "pipe did not follow DURING drag");
  assert((await state()).project.equipment.find(e => e.id === "P-01")?.x === 335, "drag must not save before drop");
  assert(!(await page.locator(".cm-content").innerText()).includes("x: 335, y: 190"), "code did not change DURING drag");
  await page.mouse.up();
  await until(async () => (await state()).project.equipment.find(e => e.id === "P-01")?.x !== 335, "drop did not persist TypeScript");
  checks.push("real drag updates code and pipe before drop, then persists the TS source");
  await hoverPump(page); assert((await page.locator(".jsdoc").innerText()).includes("Насос"), "Russian JSDoc missing");
  await page.mouse.move(5, 5); await page.getByRole("combobox", { name: "Language" }).selectOption("en");
  await hoverPump(page); assert((await page.locator(".jsdoc").innerText()).includes("measured speed"), "English JSDoc missing");
  checks.push("CodeMirror hover displays genuine TypeScript JSDoc in RU and EN");
  await page.mouse.move(5, 5);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.locator('[data-part="rotor"][data-rpm="0"]').waitFor();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.locator('[data-part="rotor"][data-rpm="1450"]').waitFor();
  checks.push("operator commands reach the driver; confirmed samples drive animation");
  await page.locator('[data-equipment="V-01"]').click();
  await page.getByRole("spinbutton", { name: "valve.opening" }).fill("0");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await until(async () => !!(await state()).snapshot.alarms["high-pressure"]?.active, "alarm did not become active");
  await page.getByRole("button", { name: /^Alarms/ }).click();
  await page.getByRole("button", { name: "Acknowledge", exact: true }).click();
  await until(async () => !!(await state()).snapshot.alarms["high-pressure"]?.acknowledged, "alarm acknowledgement did not persist");
  checks.push("real alarm activation and acknowledgement");
  await page.getByRole("spinbutton", { name: "valve.opening" }).fill("75");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.locator(".trend polyline").waitFor(); checks.push("historian chart reads stored measurements");
  await page.getByRole("button", { name: "Git", exact: true }).click();
  await page.getByRole("textbox", { name: "Describe this change" }).fill("Move pump through the actual IDE");
  await page.getByRole("button", { name: "Commit", exact: true }).click();
  await until(async () => !(await execute(["git","status","--porcelain"], f.root)).trim(), "Git commit failed");
  checks.push("IDE commits a real source change to Git");
  await page.getByRole("button", { name: "Signals", exact: true }).click();
  await page.locator('[data-equipment="P-01"]').click();
  const closeNotice = page.getByRole("button", { name: "Close", exact: true });
  if (await closeNotice.isVisible()) await closeNotice.click();
  await page.getByRole("combobox", { name: "Language" }).selectOption("ru");
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.screenshot({ path: "artifacts/ide-light.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: "artifacts/ide-dark.png" });
  await page.getByRole("button", { name: "Код", exact: true }).click();
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: "artifacts/ide-ipad.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile page overflows horizontally");
  await page.screenshot({ path: "artifacts/ide-mobile.png" });
  await page.setViewportSize({ width: 320, height: 240 });
  await page.goto(`${base}/hmi`);
  await page.locator('[data-equipment="P-01"]').waitFor();
  await page.screenshot({ path: "artifacts/hmi-320x240.png" });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), "HMI overflows its physical viewport");
  checks.push("actual UI renders at desktop, iPad, phone and 320×240 HMI viewports");
  assert(errors.length === 0, errors.join("\n"));
  console.log(checks.map(c => `PASS ${c}`).join("\n"));
} catch (error) {
  errors.push(error instanceof Error ? error.message : String(error));
  const page = browser?.contexts()[0]?.pages()[0];
  await page?.screenshot({ path: "artifacts/failure.png" }).catch(() => {});
  throw error;
} finally {
  await Bun.write("artifacts/browser-report.json", JSON.stringify({ checks, errors }, null, 2));
  await browser?.close(); process.kill("SIGTERM"); await process.exited;
  await Bun.write("artifacts/server.log", `${await stdout}\n${await stderr}`); f.clean();
}
