import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { roundedRoute } from '../src/shell/route3d';

test('rounded 3D pipe keeps terminal endpoints and joins every orthogonal turn', () => {
  const points = [new Vector3(0, 5, 0), new Vector3(40, 5, 0), new Vector3(40, 5, 30), new Vector3(40, 25, 30)];
  const { path, bends } = roundedRoute(points, 12);
  expect(bends).toBe(2);
  expect(path.getPointAt(0).distanceTo(points[0]!)).toBeLessThan(1e-6);
  expect(path.getPointAt(1).distanceTo(points.at(-1)!)).toBeLessThan(1e-6);
  expect(path.curves.length).toBe(5);
  for (let i = 0; i <= 100; i++) {
    const point = path.getPointAt(i / 100);
    expect([point.x, point.y, point.z].every(Number.isFinite)).toBe(true);
  }
});

test('elevated panel cable retains its outward lead, riser and loose endpoint', () => {
  const authored = [new Vector3(10, 26, 5), new Vector3(10, 26, -42), new Vector3(10, 85, -42), new Vector3(80, 85, -42)];
  const {path,bends}=roundedRoute(authored,6);
  expect(bends).toBe(2);
  expect(path.getPointAt(0)).toEqual(authored[0]!);
  expect(path.getPointAt(1)).toEqual(authored.at(-1)!);
  const lead=path.curves[0]!;
  expect(lead.getPoint(1).y).toBe(26);
  expect(lead.getPoint(1).z).toBeLessThan(5);
  expect(path.curves[2]!.getPoint(0).z).toBe(-42);
  expect(path.curves[2]!.getPoint(1).z).toBe(-42);
});
