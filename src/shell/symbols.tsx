import { useId, type ReactNode } from "react";
import { equipmentSignal, type Equipment, type Locale, type Snapshot } from "../core";
import {instrumentReading,instrumentStyle} from './instrument-style';

// Anatomy and native coordinates ported from Pom4H/saturn, src/equipment-svg.ts
// at 90da21a1885a72022b7a2d1b45cb36993bee1597. No per-symbol scaling or connector adapters.
const metal = "#c7dbe1", dark = "#385967";
function Rect({ x, y, w, h, r = 2, fill = metal }: { x: number; y: number; w: number; h: number; r?: number; fill?: string }) {
  return <rect x={x} y={y} width={w} height={h} rx={r} fill={fill} stroke="#718e9c" strokeWidth={1.4} />;
}
function Bolt({ x, y, r = 2 }: { x: number; y: number; r?: number }) { return <circle cx={x} cy={y} r={r} fill="#78949f" stroke="#eff6f7" strokeWidth={.8} />; }
function Label({ x, y, children, size = 12 }: { x: number; y: number; children: ReactNode; size?: number }) { return <text x={x} y={y} textAnchor="middle" fontSize={size} fontFamily="ui-monospace, monospace" fontWeight={600} fill="#17485c">{children}</text>; }
function InstrumentSymbol({equipment,snapshot}:{equipment:Equipment;snapshot:Snapshot}){
  const reading=instrumentReading(equipment,snapshot)!,form=reading.form;
  const canonical=form==='inline'?{width:120,height:90}:{width:100,height:110};
  const width=equipment.capabilities.diagram?.width??canonical.width,height=equipment.capabilities.diagram?.height??canonical.height;
  const value=`${reading.display}${reading.unit&&reading.value!==null?` ${reading.unit}`:''}`;
  const s=instrumentStyle;
  return <g data-anatomy="saturn-instrument" data-form={form} data-reading={reading.value===null?'stale':'good'} transform={`scale(${width/canonical.width} ${height/canonical.height})`}>
    {form==='dial'?<>
      <ellipse cx={50} cy={107} rx={39} ry={3} fill={s.ink} opacity={.12}/>
      <rect x={46} y={80} width={8} height={27} rx={2} fill={s.metal} stroke={s.rim} strokeWidth={1.5}/>
      <circle cx={50} cy={47} r={43} fill={s.metal} stroke={s.rim} strokeWidth={2.5}/>
      <circle cx={50} cy={47} r={35} fill={s.face} stroke="#a8c0ca" strokeWidth={1.5}/>
      {Array.from({length:9},(_,index)=>{const angle=(135+index*270/8)*Math.PI/180;return <line key={index} x1={50+26*Math.cos(angle)} y1={47+26*Math.sin(angle)} x2={50+31*Math.cos(angle)} y2={47+31*Math.sin(angle)} stroke={s.rim} strokeWidth={index%2===0?2:1.2}/>;})}
      {reading.fraction!==null&&(()=>{const angle=(135+reading.fraction*270)*Math.PI/180;return <line data-part="needle" x1={50} y1={47} x2={50+25*Math.cos(angle)} y2={47+25*Math.sin(angle)} stroke={s.needle} strokeWidth={3.4} strokeLinecap="round"/>;})()}
      <circle cx={50} cy={47} r={4} fill={s.rim}/>
      <rect x={9} y={85} width={82} height={23} rx={5} fill={s.face} stroke="#9db8c2"/>
      <text x={50} y={101} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={12} fontWeight={700} fill={reading.value===null?s.stale:s.ink}>{value}</text>
    </>:form==='digital'?<>
      <ellipse cx={50} cy={108} rx={38} ry={3} fill={s.ink} opacity={.12}/>
      <rect x={45} y={82} width={10} height={26} rx={2} fill={s.metal} stroke={s.rim} strokeWidth={1.5}/>
      <rect x={5} y={7} width={90} height={80} rx={11} fill={s.metal} stroke={s.rim} strokeWidth={2.5}/>
      <rect x={13} y={18} width={74} height={55} rx={5} fill={s.screen} stroke="#8bb0bd" strokeWidth={1.5}/>
      <text x={50} y={52} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={23} fontWeight={700} fill={reading.value===null?s.stale:s.light}>{reading.display}</text>
      <text x={50} y={66} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={10} fill={s.light}>{reading.unit}</text>
      <circle cx={82} cy={80} r={2.5} fill={reading.value===null?s.stale:s.fluid}/>
    </>:<>
      <rect x={0} y={39} width={120} height={16} rx={3} fill={s.metal} stroke={s.rim} strokeWidth={2}/>
      {[5,103].map(x=><g key={x}><rect x={x} y={31} width={12} height={32} rx={2} fill={s.metal} stroke={s.rim} strokeWidth={1.5}/><circle cx={x+6} cy={35} r={1.8} fill={s.face}/><circle cx={x+6} cy={59} r={1.8} fill={s.face}/></g>)}
      <rect x={29} y={3} width={62} height={48} rx={9} fill={s.metal} stroke={s.rim} strokeWidth={2.5}/>
      <rect x={36} y={10} width={48} height={31} rx={4} fill={s.screen}/>
      <text x={60} y={31} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={14} fontWeight={700} fill={reading.value===null?s.stale:s.light}>{reading.display}</text>
      <text x={60} y={74} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize={10} fill={s.ink}>{reading.unit}</text>
    </>}
  </g>;
}
export function Symbol({ equipment: e, snapshot, locale }: { equipment: Equipment; snapshot: Snapshot; locale: Locale }) {
  const clip = useId().replace(/:/g, "");
  const number = (id: string) => { const s = snapshot.samples[id]; return s?.quality === "good" && typeof s.value === "number" ? s.value : null; };
  if(e.capabilities.instrument)return <InstrumentSymbol equipment={e} snapshot={snapshot}/>;
  if (e.kind === "tee") {
    return <g data-anatomy="saturn-tee">
      <path d="M0 40H80M40 40V0" fill="none" stroke="var(--pipe-rim)" strokeWidth={28} strokeLinecap="butt" strokeLinejoin="round"/>
      <path d="M0 40H80M40 40V0" fill="none" stroke="var(--pipe-shell)" strokeWidth={23} strokeLinecap="butt" strokeLinejoin="round"/>
      <path d="M0 40H80M40 40V0" fill="none" stroke="var(--pipe-fill)" strokeWidth={15} strokeLinecap="butt" strokeLinejoin="round"/>
      <circle cx={40} cy={40} r={9} fill="var(--pipe-fill)" stroke="var(--pipe-shell)" strokeWidth={4}/>
    </g>;
  }
  if (e.kind === "tank") {
    const levelSignal=equipmentSignal<number>(e,"level","number"), level=levelSignal?number(levelSignal.id):null, y = 195 - Math.max(0, Math.min(100, level ?? 0)) * 1.44;
    return <g data-anatomy="saturn-tank">
      <ellipse cx={79} cy={226} rx={67} ry={4} fill="#1c4055" opacity={.07}/>
      <Rect x={28} y={193} w={12} h={31} r={1} fill={dark}/><Rect x={120} y={193} w={12} h={31} r={1} fill={dark}/>
      <Rect x={120} y={172} w={50} h={24}/><Rect x={157} y={167} w={11} h={34}/>
      <path d="M18 42 C18 15 140 15 140 42V193C140 218 18 218 18 193Z" fill="#e4f2f5" fillOpacity={.65} stroke="#86a2ae" strokeWidth={2}/>
      <defs><clipPath id={clip}><path d="M23 45C23 24 135 24 135 45V192C135 211 23 211 23 192Z"/></clipPath></defs>
      <g clipPath={`url(#${clip})`} opacity={level === null ? 0 : 1}>
        <rect className="fluid" x={20} y={y} width={120} height={215 - y} fill="#46b4cb" opacity={.82}/>
        <ellipse className="surface" cx={79} cy={y} rx={60} ry={9} fill="#a2e5ed" stroke="#d5f6f9" strokeWidth={1.2}/>
      </g>
      <path d="M29 52V187M34 58V183" stroke="#fff" strokeWidth={2.5} opacity={.5}/>
      <ellipse cx={79} cy={41} rx={61} ry={15} fill={metal} stroke="#86a2ae" strokeWidth={1.5}/>
      <Rect x={68} y={3} w={23} h={25} r={1}/><Label x={79} y={135} size={22}>{level === null ? "—" : `${Math.round(level)}%`}</Label>
    </g>;
  }
  if (e.kind === "pump") {
    const rpmSignal=equipmentSignal<number>(e,"rpm","number"), rpm=rpmSignal?number(rpmSignal.id):null, running = rpm !== null && rpm > 1;
    return <g data-anatomy="saturn-pump">
      <ellipse cx={118} cy={160} rx={95} ry={5} fill="#254e60" opacity={.07}/>
      <path d="M40 132 32 151H109L100 132M143 130 138 151H207L200 130" fill={dark} stroke="#547685"/>
      <Rect x={25} y={151} w={190} h={7}/>{[34,107,142,205].map(x => <Bolt key={x} x={x} y={154} r={1.7}/>)}
      <Rect x={0} y={84} w={40} h={24}/><Rect x={0} y={79} w={10} h={34}/>{[84,108].map(y => <Bolt key={y} x={5} y={y} r={1.7}/>)}
      <Rect x={64} y={0} w={24} h={57}/><Rect x={58} y={1} w={36} h={9}/>{[64,87].map(x => <Bolt key={x} x={x} y={5} r={1.7}/>)}
      <Rect x={114} y={82} w={23} h={26}/><Rect x={129} y={57} w={81} h={77} r={13} fill={dark}/>
      {Array.from({ length: 9 }, (_, i) => 141 + i * 7).map(x => <g key={x}><path d={`M${x} 65V126`} stroke="#0b2c3c" strokeWidth={3.5}/><path d={`M${x+1} 66V125`} stroke="#65818e"/></g>)}
      <Rect x={203} y={66} w={12} h={60} r={6} fill={dark}/><Rect x={155} y={40} w={29} h={21} r={3} fill={dark}/>
      <circle cx={76} cy={96} r={48} fill={metal} stroke="#7b97a3" strokeWidth={2}/>
      <circle cx={76} cy={96} r={39} fill={dark} stroke="#acbfc7" strokeWidth={3}/>
      <circle cx={76} cy={96} r={32} fill="#143e50" stroke="#deedf1" strokeWidth={1.3}/>
      <g data-part="rotor" data-origin-x="76" data-origin-y="96" data-rpm={rpm ?? "unknown"} style={{ opacity: rpm === null ? .3 : 1 }}>
        {[0,72,144,216,288].map(angle => <path key={angle} d="M76 91C83 87 96 86 101 75C105 89 94 101 82 104Z" transform={`rotate(${angle} 76 96)`} fill={metal} stroke="#abc0c9" strokeWidth={.65}/>)}
      </g>
      <circle cx={76} cy={96} r={8} fill={metal} stroke="#718f9c"/>
      {[0,60,120,180,240,300].map(angle => <Bolt key={angle} x={76+43*Math.cos(angle*Math.PI/180)} y={96+43*Math.sin(angle*Math.PI/180)} r={2.3}/>)}
      <circle cx={141} cy={145} r={2.4} fill={running ? "#23a381" : "#91a7af"}/>
      <Label x={171} y={149} size={9}>{rpm === null ? "—" : running ? (locale === "ru" ? "РАБОТА" : "RUNNING") : (locale === "ru" ? "СТОП" : "STOPPED")}</Label>
    </g>;
  }
  if (e.kind === "valve") {
    const openingSignal=equipmentSignal<number>(e,"opening","number"), opening=openingSignal?number(openingSignal.id):null, travel = Math.max(0, Math.min(100, opening ?? 0));
    return <g data-anatomy="saturn-valve">
      <Rect x={0} y={90} w={160} h={24}/>{[7,137].map(x => <g key={x}><Rect x={x} y={81} w={13} h={42} r={3}/>{[88,116].map(y => <Bolt key={y} x={x+6.5} y={y}/>)}</g>)}
      <path d="M43 88 62 72H98L119 88V116L98 132H62L43 116Z" fill={metal} stroke="#6d8d9b" strokeWidth={1.4}/>
      <Rect x={57} y={88} w={46} h={29} r={6} fill="#0ca6c0"/>
      <rect data-part="gate" x={59} y={90} width={42} height={25*(1-travel/100)} rx={2} fill={metal} stroke="#587d90" visibility={opening === null ? "hidden" : "visible"}/>
      <g transform={`translate(0 ${-travel*.11})`}><rect x={77} y={40} width={6} height={42} rx={1} fill={metal} stroke="#66899c"/></g>
      <path d="M61 73V31H99V73M57 73H104" fill="none" stroke="#5f7f8f" strokeWidth={4}/>
      <Rect x={51} y={6} w={58} h={28} r={6} fill={dark}/><Rect x={60} y={13} w={40} h={9} r={2} fill="#9abcc9"/>
      <Label x={80} y={156} size={14}>{opening === null ? "—" : `${Math.round(opening)}%`}</Label>
    </g>;
  }
  const onlineSignal=equipmentSignal<boolean>(e,"online","boolean"), online=onlineSignal?snapshot.samples[onlineSignal.id]:undefined;
  return <g data-anatomy="generic-plc"><Rect x={0} y={0} w={160} h={145} r={5} fill={dark}/>
    {[0,1,2,3,4,5,6,7].map(i => <g key={i}><Rect x={8+i*18} y={0} w={12} h={15}/><Rect x={8+i*18} y={130} w={12} h={15}/></g>)}
    <Rect x={18} y={32} w={124} h={66} r={2} fill="#e0f0ed"/><Label x={80} y={62} size={14}>{e.id}</Label>
    <Label x={80} y={84}>{online?.quality === "good" ? online.value ? "ONLINE" : "OFFLINE" : "—"}</Label>
    {[40,66,92,118].map(x => <Rect key={x} x={x} y={110} w={14} h={10} r={1}/>)}</g>;
}
