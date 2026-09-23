import { alarm, pipe, project, pump, signal, tank, valve } from "@saturn/core";

const signals = {
  run: signal("pump.run", { initial: true, writable: true }),
  rpm: signal("pump.rpm", { initial: 0, unit: "rpm", min: 0, max: 3000 }),
  level: signal("tank.level", { initial: 64, unit: "%", min: 0, max: 100 }),
  opening: signal("valve.opening", { initial: 75, unit: "%", writable: true, min: 0, max: 100 }),
  flow: signal("station.flow", { initial: 0, unit: "m³/h", min: 0 }),
  pressure: signal("station.pressure", { initial: 0, unit: "bar", min: 0 }),
};

const reservoir = tank("TK-01", {
  label: { en: "Supply tank", ru: "Питающий резервуар" },
  x: 60, y: 65,
  level: signals.level,
});

const booster = pump("P-01", {
  label: { en: "Booster pump", ru: "Повысительный насос" },
  x: 335, y: 190,
  rpm: signals.rpm,
  run: signals.run,
});

const outlet = valve("V-01", {
  label: { en: "Outlet valve", ru: "Выходной клапан" },
  x: 630, y: 65,
  opening: signals.opening,
});

export default project({
  id: "pumping-station",
  label: { en: "Pumping station", ru: "Насосная станция" },
  signals,
  equipment: [reservoir, booster, outlet],
  hmi: { width: 320, height: 240, equipment: [reservoir, booster, outlet] },
  pipes: [
    pipe("suction", { from: reservoir, to: booster, flow: signals.flow }),
    pipe("discharge", { from: booster, to: outlet, flow: signals.flow }),
  ],
  alarms: [
    alarm("high-pressure", {
      label: { en: "High discharge pressure", ru: "Высокое давление на выходе" },
      signal: signals.pressure, above: 4.5, hysteresis: 0.25,
    }),
  ],
});
