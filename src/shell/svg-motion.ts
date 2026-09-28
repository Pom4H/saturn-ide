import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Equipment, Pipe, Project, Snapshot } from '../core';
import { advancePhase, flowOf, rpmOf } from '../motion';
/** One clock per visible scene; React owns geometry, this hook owns measured motion only. */
export function useSvgMotion(root: RefObject<SVGSVGElement | null>, project: Project, snapshot: Snapshot, focus?: string) {
  const latest = useRef({ project, snapshot }); latest.current = { project, snapshot };
  const phases = useRef(new Map<string, number>());
  const nodes = useRef<{ rotors: { equipment: Equipment; node: SVGGElement }[]; pipes: { pipe: Pipe; node: SVGPathElement; fluid: SVGPathElement | null }[] }>({ rotors: [], pipes: [] });
  const paint = useRef<(dt: number) => void>(() => {});
  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg) return;
    // No querySelector, media query creation, geometry read or React update in the frame loop.
    nodes.current = {
      rotors: project.equipment.flatMap(equipment => {
        const node = svg.querySelector<SVGGElement>(`[data-equipment="${equipment.id}"] [data-part="rotor"]`);
        return node ? [{ equipment, node }] : [];
      }),
      pipes: project.pipes.flatMap(pipe => {
        const node = svg.querySelector<SVGPathElement>(`[data-pipe="${pipe.id}"] .flow`);
        return node ? [{ pipe, node, fluid:svg.querySelector<SVGPathElement>(`[data-pipe="${pipe.id}"] .pipe-fluid`) }] : [];
      }),
    };
    const alive = new Set([...project.equipment, ...project.pipes].map(e => e.id));
    for (const id of phases.current.keys()) if (!alive.has(id)) phases.current.delete(id);
    paint.current(0);
  }, [root, project, focus]);
  useLayoutEffect(() => { paint.current(0); }, [snapshot]);
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0, last = 0, disposed = false;
    paint.current = dt => {
      const { project: p, snapshot: s } = latest.current;
      for (const { equipment, node } of nodes.current.rotors) {
        const rpm = rpmOf(equipment, s), rate = reduced.matches || rpm === null ? 0 : rpm / 1450 * .35;
        const phase = advancePhase(phases.current.get(equipment.id) ?? 0, rate, dt);
        phases.current.set(equipment.id, phase); node.style.animation = 'none';
        node.style.transform = `rotate(${phase * 360}deg)`; node.dataset.phase = String(phase);
      }
      for (const { pipe, node, fluid } of nodes.current.pipes) {
        const flow = flowOf(pipe, p, s), rate = reduced.matches || flow === null ? 0 : Math.sign(flow) * Math.min(2, Math.abs(flow) / 18);
        const phase = advancePhase(phases.current.get(pipe.id) ?? 0, rate, dt);
        phases.current.set(pipe.id, phase); node.style.animation = 'none';
        node.style.strokeDashoffset = String(-phase * 48); node.style.opacity = flow === null || flow === 0 ? '0' : '.8';
        if(fluid)fluid.style.stroke=flow===null?'var(--pipe-stale)':'var(--pipe-fill)';
      }
    };
    const tick = (now: number) => {
      frame = 0;
      if (disposed || document.hidden || reduced.matches) return;
      paint.current(last ? (now - last) / 1000 : 0); last = now;
      frame = requestAnimationFrame(tick);
    };
    const visibility = () => {
      cancelAnimationFrame(frame); frame = 0; last = 0; paint.current(0);
      if (!disposed && !document.hidden && !reduced.matches) frame = requestAnimationFrame(tick);
    };
    document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', visibility); visibility();
    return () => { disposed = true; cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', visibility); paint.current = () => {}; };
  }, []);
}
