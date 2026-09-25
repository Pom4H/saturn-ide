import { isAttached, type ConnectionEnd, type Point } from '../../core';

export interface EquipmentHit {
  distance: number;
  port?: { device: string; port: string };
}
/** A port's editor hit-target surrounds its attached plug. It is not an occluding wall.
 * Real equipment surfaces and other ports still occlude handles behind them. */
export function connectionHandleVisible(end: ConnectionEnd, distance: number, hit?: EquipmentHit): boolean {
  return !hit || distance <= hit.distance + .01 || isAttached(end) &&
    hit.port?.device === end.device && hit.port.port === end.port;
}
/** A vertical gesture changes height only, even when a terminal has fractional coordinates. */
export function connectionDragPoint(previous: Point, next: Point, vertical: boolean): Point {
  return vertical ? { x: previous.x, y: previous.y, z: Math.round(next.z) }
    : { x: Math.round(next.x), y: Math.round(next.y), z: Math.round(next.z) };
}
