import { useRef, type PointerEvent } from "react";
import { text, type Equipment, type Locale, type Project, type Snapshot } from "../core";
import { geometry, route } from "../geometry";
import { Symbol } from "./symbols";
interface Props {
  project: Project; snapshot: Snapshot; locale: Locale; selected: string; focus?: string;
  preview?: { id: string; x: number; y: number } | null;
  select: (id: string) => void; begin?: (id: string) => boolean;
  move?: (id: string, x: number, y: number) => void; end?: (cancel: boolean) => void;
}
export function Scene(props: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; x: number; y: number; startX: number; startY: number; moved: boolean } | null>(null);
  const coordinate = (event: PointerEvent) => {
    const p = svg.current!.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    return p.matrixTransform(svg.current!.getScreenCTM()!.inverse());
  };
  const base = props.focus ? props.project.equipment.filter(e => e.id === props.focus) : props.project.equipment;
  const items = base.map(e => props.preview?.id === e.id ? { ...e, x: props.preview.x, y: props.preview.y } : e);
  const minX = Math.min(0, ...base.map(e => e.x - 32)), minY = Math.min(0, ...base.map(e => e.y - 36));
  const maxX = Math.max(850, ...base.map(e => e.x + geometry[e.kind].width + 40));
  const maxY = Math.max(415, ...base.map(e => e.y + geometry[e.kind].height + 56));
  const focused = props.focus ? base[0] : undefined;
  const viewBox = focused ? `${focused.x - 18} ${focused.y - 30} ${geometry[focused.kind].width + 36} ${geometry[focused.kind].height + 70}` : `${minX} ${minY} ${maxX-minX} ${maxY-minY}`;
  const start = (event: PointerEvent, e: Equipment) => {
    props.select(e.id);
    if (event.button !== 0 || !props.begin?.(e.id)) return;
    const p = coordinate(event);
    drag.current = { id: e.id, x: e.x, y: e.y, startX: p.x, startY: p.y, moved: false };
    svg.current!.setPointerCapture(event.pointerId);
  };
  const finish = (cancel: boolean) => { if (drag.current) { const d = drag.current; drag.current = null; props.end?.(cancel || !d.moved); } };
  return <svg ref={svg} className="scene" aria-label={props.locale === "ru" ? "Мнемосхема" : "Process diagram"} viewBox={viewBox} tabIndex={0}
    onPointerMove={event => { const d = drag.current; if (!d) return; const p = coordinate(event); if (Math.hypot(p.x-d.startX,p.y-d.startY) > 3) d.moved = true; if (d.moved) props.move?.(d.id, Math.round(d.x+p.x-d.startX), Math.round(d.y+p.y-d.startY)); }}
    onPointerUp={() => finish(false)} onPointerCancel={() => finish(true)} onLostPointerCapture={() => finish(true)} onKeyDown={event => { if (event.key === "Escape") finish(true); }}>
    {!props.focus && props.project.pipes.map(edge => {
      const from = items.find(e => e.id === edge.from), to = items.find(e => e.id === edge.to); if (!from || !to) return null;
      const sample = props.snapshot.samples[edge.flow.id], value = sample?.quality === "good" && typeof sample.value === "number" ? sample.value : null;
      const d = route(from, to);
      return <g key={edge.id} data-pipe={edge.id} className={value === null ? "pipe unknown" : "pipe"}>
        <path d={d} stroke="var(--pipe-rim)" strokeWidth={12} fill="none" strokeLinejoin="round"/>
        <path d={d} stroke="var(--pipe-fill)" strokeWidth={8} fill="none" strokeLinejoin="round"/>
        <path className="flow" d={d} stroke="var(--flow)" strokeWidth={3} strokeDasharray="8 15" fill="none" style={{ animationPlayState: value !== null && value > .01 ? "running" : "paused", opacity: value === null ? 0 : .8 }}/>
      </g>;
    })}
    {items.map(e => {
      const g = geometry[e.kind];
      return <g key={e.id} data-equipment={e.id} transform={`translate(${e.x} ${e.y})`} className={props.selected === e.id ? "equipment selected" : "equipment"}
        onPointerDown={event => start(event, e)} role="button" tabIndex={0} aria-label={`${e.id} ${text(e.label, props.locale)}`}
        onKeyDown={event => { if (event.key === "Enter") props.select(e.id); }}>
        <rect className="selection" x={-12} y={-28} width={g.width+24} height={g.height+64} rx={4}/>
        <text className="equipment-id" x={0} y={-13}>{e.id}</text>
        <Symbol equipment={e} snapshot={props.snapshot} locale={props.locale}/>
        <text className="equipment-name" x={g.width/2} y={g.height+24} textAnchor="middle">{text(e.label, props.locale)}</text>
      </g>;
    })}
  </svg>;
}
