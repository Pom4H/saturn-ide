import type { Driver, Value } from "@saturn/core";

// Demonstration only: not a hydraulic solver or a safety controller.
// Copy this file and import a real driver from server.ts to replace it.
const commands: Record<string, Value> = {};
const driver: Driver = {
  mode: "simulation",
  async start({ project, snapshot, publish }) {
    let disposed = false;
    let elapsed = 0;
    let timer: ReturnType<typeof setTimeout>;
    for (const s of Object.values(project.signals)) commands[s.id] ??= snapshot.samples[s.id]?.value ?? s.initial;
    const tick = async () => {
      if (disposed) return;
      const running = commands["pump.run"] === true;
      const opening = Number(commands["valve.opening"] ?? 0);
      const rpm = running ? 1450 : 0;
      const flow = running ? opening * 0.24 : 0;
      const pressure = running ? 2 + (100 - opening) * 0.038 : 0;
      await publish({
        "pump.run": running, "pump.rpm": rpm, "valve.opening": opening,
        "station.flow": flow, "station.pressure": pressure,
        "tank.level": 64 + Math.sin(elapsed++ / 30) * 3,
      });
      if (!disposed) timer = setTimeout(() => void tick().catch(console.error), 1000);
    };
    await tick();
    return () => { disposed = true; clearTimeout(timer); };
  },
  async write(id, value) { commands[id] = value; },
};
export default driver;
