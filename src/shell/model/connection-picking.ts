import { isAttached, type ConnectionEnd } from '../../core';

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
