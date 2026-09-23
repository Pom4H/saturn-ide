import { existsSync, mkdirSync, writeFileSync, cpSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

export function scaffold(kind: string, name: string, projectRoot = resolve(Bun.env.SATURN_PROJECT ?? "project")) {
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(name)) throw new Error("Use a lowercase name: plc-01");
  if (kind !== "plc" && kind !== "plugin") throw new Error("Usage: bun run scaffold <plc|plugin> <name>");
  const destination = join(projectRoot, kind === "plc" ? "equipment" : "plugins", name);
  if (existsSync(destination)) throw new Error(`Already exists: ${destination}`);
  mkdirSync(destination, { recursive: true });
  if (kind === "plugin") {
    writeFileSync(join(destination, "index.ts"), `import { signal } from "@saturn/core";\n\n/** @ru Скопированный модуль проекта.\n * @en A copied project module. */\nexport const enabled = signal("${name}.enabled", { initial: false });\n`);
  } else {
    writeFileSync(join(destination, "device.ts"), `import { plc, signal } from "@saturn/core";\n\nexport const online = signal("${name}.online", { initial: false });\nexport const controller = plc("${name}", {\n  label: { en: "Controller", ru: "Контроллер" },\n  x: 60, y: 60, online,\n});\n`);
    writeFileSync(join(destination, "hmi.ts"), `import type { Hmi } from "@saturn/core";\nimport { controller } from "./device";\n\n// The same equipment objects, not another HMI model or a second renderer.\nexport default { width: 320, height: 240, equipment: [controller] } satisfies Hmi;\n`);
    writeFileSync(join(destination, "compiler.ts"), `import type { FirmwareContext } from "@saturn/core";\n\n/** @ru Подключите реальный компилятор и параметры целевого ПЛК.\n * @en Connect the actual compiler and the target PLC configuration. */\nexport default async function compile(context: FirmwareContext): Promise<void> {\n  // await context.run(["vendor-compiler", "firmware/main.c", "-o", context.outDir + "/firmware.bin"]);\n  // Deliberately fail until a real toolchain is configured. Never emit a fake firmware.bin.\n  throw new Error("Configure this PLC's compiler.ts with its real toolchain before building firmware");\n}\n`);
    mkdirSync(join(destination, "firmware"));
    writeFileSync(join(destination, "firmware/README.md"), "# Firmware sources\n\nPlace this controller's sources, target memory map and build inputs here. Configure ../compiler.ts for its vendor toolchain. The generic PLC scaffold is not a Saturn PLC hardware driver.\n");
  }
  return destination;
}
export function create(destination: string) {
  const target = resolve(destination), appRoot = resolve(import.meta.dir, "..");
  if (existsSync(target)) throw new Error("Destination already exists");
  mkdirSync(target, { recursive: true });
  for (const name of ["src", "project", "scripts", "tests", "package.json", "tsconfig.json", ".gitignore", ".env.example", "README.md"]) cpSync(join(appRoot, name), join(target, name), { recursive: true });
  if (existsSync(join(appRoot, "bun.lock"))) cpSync(join(appRoot, "bun.lock"), join(target, "bun.lock"));
  return target;
}
if (import.meta.main) {
  const [kind, name] = Bun.argv.slice(2);
  if (!kind || !name) throw new Error("Usage: bun run scaffold <plc|plugin|project> <name>");
  console.log(kind === "project" ? create(name) : scaffold(kind, name));
  console.log("Import the generated definitions from project.ts. Files are yours; nothing is registered globally.");
}
