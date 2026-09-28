import { isAttached, validateProject, type Endpoint, type Project } from '../../core';
import { canonical } from '../../core/artifact';
import { decodeProject } from '../../core/project-codec';

/** The same authored connection contract serves 2D and 3D gestures. Evaluate once at drag start. */
export function compatiblePorts(project: Project, connectionId: string, end: 'from' | 'to'): Endpoint[] {
  // decodeProject checks and freezes the complete authored model. Only the selected
  // end changes below, so equivalent candidate ends need one full validation.
  const authored = decodeProject(canonical(project));
  const edge = [...authored.pipes, ...(authored.cables ?? [])].find(item => item.id === connectionId);
  if (!edge) return [];
  const ports = authored.equipment.flatMap(device => Object.values(device.ports));
  const devices = new Map(authored.equipment.map(device => [device.id, device]));
  const occupancy = new Map<string, number>();
  const portKey = (port: Endpoint) => `${port.device}.${port.port}`;
  for (const connection of [...authored.pipes, ...(authored.cables ?? [])]) {
    for (const attached of [connection.from, connection.to]) {
      if (!isAttached(attached)) continue;
      const key = portKey(attached);
      occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
    }
  }
  const previous = edge[end];
  const previousKey = isAttached(previous) ? portKey(previous) : null;
  const opposite = edge[end === 'from' ? 'to' : 'from'];
  const classes = new Map<string, boolean>();
  const validate = (target: Endpoint): boolean => {
    try {
      validateProject({
        ...authored,
        pipes: authored.pipes.map(connection => connection.id === connectionId ? { ...connection, [end]: target } : connection),
        cables: authored.cables?.map(connection => connection.id === connectionId ? { ...connection, [end]: target } : connection),
      });
      return true;
    } catch { return false; }
  };
  const signature = (target: Endpoint): string | null => {
    // A project may contain an unusual endpoint object in its port dictionary.
    // Such a candidate is still evaluated by the full validator individually.
    if ('kind' in target || typeof target.device !== 'string' || typeof target.port !== 'string') return null;
    const terminal = devices.get(target.device)?.ports[target.port]?.terminal;
    if (!terminal) return null;
    const key = portKey(target);
    // The validated project's independent fields cannot change with a rewire.
    // For this edge, validateProject reads connector type, direction, quantity,
    // same-device status and resulting use count. Port geometry is unchanged.
    return JSON.stringify([
      terminal.medium, terminal.family, terminal.role, terminal.valueType, terminal.unit, terminal.max,
      isAttached(opposite) && target.device === opposite.device,
      (occupancy.get(key) ?? 0) - (key === previousKey ? 1 : 0),
    ]);
  };
  return ports.filter(target => {
    const key = signature(target);
    if (key === null) return validate(target);
    let accepted = classes.get(key);
    if (accepted === undefined) {
      accepted = validate(target);
      classes.set(key, accepted);
    }
    return accepted;
  });
}
