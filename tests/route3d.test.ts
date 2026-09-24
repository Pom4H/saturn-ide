import { expect, test } from 'bun:test';
import { Vector3 } from 'three';
import { projectPanelCable, roundedRoute } from '../src/shell/route3d';

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

test('panel cable leaves end-face sockets along their outward normals', () => {
  const authored = [new Vector3(10, 26, 5), new Vector3(10, 26, 20), new Vector3(10, 85, 20), new Vector3(80, 85, 20)];
  const projected = projectPanelCable(authored, 'up', null);
  expect(projected[0]).toEqual(authored[0]);
  expect(projected[1]).toEqual(new Vector3(10, 26, -7));
  expect(projected.at(-1)).toEqual(authored.at(-1));
  expect(projected[2]?.y).toBe(85);
  const incoming = projectPanelCable(authored, null, 'down');
  expect(incoming.at(-2)).toEqual(new Vector3(80, 85, 32));
  expect(incoming.at(-1)).toEqual(authored.at(-1));
});
