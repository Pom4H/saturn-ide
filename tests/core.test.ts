import { expect, test } from "bun:test";
import { project, pump, signal, validateValue } from "../src/core";
import demo from "../project/project";
import { route } from "../src/geometry";

test("one typed engineering model and real pipe endpoints", () => {
  expect(demo.equipment).toHaveLength(3);
  expect(demo.pipes[0]?.from).toBe("TK-01");
  const a = demo.equipment[0]!, b = demo.equipment[1]!;
  expect(route(a, b)).not.toBe(route(a, { ...b, x: b.x + 50 }));
});
test("invalid ranges and duplicate IDs fail at the model boundary", () => {
  expect(() => validateValue(signal("x", { initial: 2, min: 0, max: 5 }), 7)).toThrow();
  expect(() => validateValue(signal("x", { initial: 2 }), Infinity)).toThrow();
  expect(() => validateValue(signal("x", { initial: false }), 0)).toThrow();
  expect(() => project({ ...demo, equipment: [demo.equipment[0]!, demo.equipment[0]!] })).toThrow();
});
// These are compiler contracts, not runtime tests with suppressed errors.
if (false) {
  // @ts-expect-error A boolean signal cannot be used as a measured shaft speed.
  pump("invalid", { label: "Invalid", x: 0, y: 0, rpm: signal("flag", { initial: false }) });
  // @ts-expect-error A string cannot initialize a numeric signal with numeric bounds.
  signal("invalid", { initial: "text", max: 3 });
}
