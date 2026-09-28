import { cable, device, project, signal, terminal, validateProject, type Endpoint, type Project } from '../src/core';
import { canonical } from '../src/core/artifact';
import { decodeProject } from '../src/core/project-codec';
import { compatiblePorts } from '../src/shell/model/compatible-ports';

const output = (x: number) => terminal({ x, y: 0, z: 0, side: 'up', medium: 'control', family: 'digital', role: 'source', valueType: 'boolean' });
const regular = device({ id: 'bank', icon: 'bank', ports: { DO1: output(0), DO2: output(20), DO3: output(40), DO4: output(60) } });
const extra = device({ id: 'bank-extra', icon: 'bank', ports: {
  DO1: output(0), DO2: output(20), DO3: output(40), DO4: output(60), DO5: output(80),
  IN: terminal({ x: 100, y: 0, z: 0, side: 'up', medium: 'control', family: 'digital', role: 'sink', valueType: 'boolean' }),
} });

/** 128 devices and 514 real ports: the largest authored equipment set currently accepted. */
export function densePortProject(): Project {
  const sink = extra('D000', { label: 'D000', x: 0, y: 0 });
  const sources = Array.from({ length: 127 }, (_, index) => {
    const number = index + 1;
    return regular(`D${String(number).padStart(3, '0')}`, { label: `D${number}`, x: number % 16 * 700, y: Math.floor(number / 16) * 500 });
  });
  const command = signal('command', { initial: false });
  return project({
    id: 'dense-ports', label: 'Dense ports', equipment: [sink, ...sources],
    pipes: [], cables: [cable('move', { from: sources[0]!.ports.DO1, to: sink.ports.IN, signal: command })],
    alarms: [],
  });
}

/** Acceptance oracle: one full authored-project validation for every candidate. */
export function fullValidationPorts(model: Project, connectionId: string, end: 'from' | 'to'): Endpoint[] {
  const authored = decodeProject(canonical(model));
  const edge = [...authored.pipes, ...(authored.cables ?? [])].find(item => item.id === connectionId);
  if (!edge) return [];
  return authored.equipment.flatMap(equipment => Object.values(equipment.ports)).filter(target => {
    try {
      validateProject({
        ...authored,
        pipes: authored.pipes.map(connection => connection.id === connectionId ? { ...connection, [end]: target } : connection),
        cables: authored.cables?.map(connection => connection.id === connectionId ? { ...connection, [end]: target } : connection),
      });
      return true;
    } catch { return false; }
  });
}

function sample(task: () => unknown, repetitions = 15): { median: number; p95: number } {
  const durations: number[] = [];
  for (let index = 0; index < repetitions; index++) {
    const start = performance.now(); task(); durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  return { median: durations[Math.floor(durations.length / 2)]!, p95: durations[Math.floor((durations.length - 1) * .95)]! };
}

if (import.meta.main) {
  const model = densePortProject();
  fullValidationPorts(model, 'move', 'from'); compatiblePorts(model, 'move', 'from');
  const old = sample(() => fullValidationPorts(model, 'move', 'from'));
  const current = sample(() => compatiblePorts(model, 'move', 'from'));
  const format = (entry: { median: number; p95: number }) => `median ${entry.median.toFixed(2)} ms, p95 ${entry.p95.toFixed(2)} ms`;
  console.log(`Bun ${Bun.version}, devices ${model.equipment.length}, ports ${model.equipment.reduce((count, item) => count + Object.keys(item.ports).length, 0)}`);
  console.log(`Full per candidate: ${format(old)}`);
  console.log(`compatiblePorts: ${format(current)}`);
}
