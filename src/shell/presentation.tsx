import type { Hmi, Locale, PresentationElement, Snapshot, Value } from '../core';

const value = (element: PresentationElement, snapshot: Snapshot): Value | undefined => {
  const sample = element.signal ? snapshot.samples[element.signal.id] : undefined;
  return sample?.quality === 'good' ? sample.value : undefined;
};
const format = (input: Value | undefined) => input === undefined ? '—' : typeof input === 'number'
  ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(input)
  : String(input);

export function PresentationView({screen,snapshot,locale}:{screen:Hmi;snapshot:Snapshot;locale:Locale}) {
  const elements=[...(screen.elements??[])].sort((a,b)=>(a.z??0)-(b.z??0)||a.id.localeCompare(b.id));
  return <svg className="presentation-view" viewBox={'0 0 '+screen.width+' '+screen.height} role="img" aria-label={locale==='ru'?'Импортированная мнемосхема':'Imported process screen'} preserveAspectRatio="xMidYMid meet">
    {elements.map(element=><PresentationItem key={element.id} element={element} snapshot={snapshot}/>)}
  </svg>;
}

function PresentationItem({element,snapshot}:{element:PresentationElement;snapshot:Snapshot}) {
  const observed=value(element,snapshot);
  switch(element.kind){
    case 'text': {
      const content=element.signal ? element.text.replaceAll('%VALUE',format(observed)) : element.text;
      const anchor=element.align==='left'?'start':element.align==='right'?'end':'middle';
      const x=element.align==='left'?element.x:element.align==='right'?element.x+element.width:element.x+element.width/2;
      return <text data-presentation={element.id} x={x} y={element.y+Math.min(element.height,element.fontSize??14)} textAnchor={anchor} fontSize={element.fontSize??14} fill={element.color??'currentColor'}>{content}</text>;
    }
    case 'shape':
      return element.shape==='ellipse'
        ? <ellipse data-presentation={element.id} cx={element.x+element.width/2} cy={element.y+element.height/2} rx={element.width/2} ry={element.height/2} fill={element.fill??'none'} stroke={element.stroke??'currentColor'} strokeWidth={element.strokeWidth??1}/>
        : <rect data-presentation={element.id} x={element.x} y={element.y} width={element.width} height={element.height} fill={element.fill??'none'} stroke={element.stroke??'currentColor'} strokeWidth={element.strokeWidth??1}/>;
    case 'image':
      return element.href
        ? <image data-presentation={element.id} href={element.href} x={element.x} y={element.y} width={element.width} height={element.height} preserveAspectRatio="xMidYMid meet"/>
        : <Placeholder element={element} label={element.alt??'image'}/>;
    case 'progress': {
      const numeric=typeof observed==='number'?observed:element.current;
      const ratio=numeric===undefined?0:Math.max(0,Math.min(1,(numeric-element.min)/Math.max(Number.EPSILON,element.max-element.min)));
      return <g data-presentation={element.id}><rect x={element.x} y={element.y} width={element.width} height={element.height} fill={element.background??'#e5e7eb'}/><rect x={element.x} y={element.y} width={element.width*ratio} height={element.height} fill={element.fill??'#0ea5e9'}/></g>;
    }
    case 'list': {
      const index=typeof observed==='number'?Math.trunc(observed):undefined;
      const label=index!==undefined&&element.lines[index]!==undefined?element.lines[index]:element.lines.join(' · ');
      return <text data-presentation={element.id} x={element.x} y={element.y+14} fontSize={12} fill="currentColor">{label}</text>;
    }
    case 'polyline':
      return <polyline data-presentation={element.id} points={element.points.map(point=>(element.x+point.x)+','+(element.y+point.y)).join(' ')} fill={element.fill??'none'} stroke={element.stroke??'currentColor'} strokeWidth={element.strokeWidth??1}/>;
    case 'placeholder':
      return <Placeholder element={element} label={element.label}/>;
  }
}
function Placeholder({element,label}:{element:PresentationElement;label:string}) {
  return <g data-presentation={element.id} data-placeholder="true"><rect x={element.x} y={element.y} width={element.width} height={element.height} rx={4} fill="none" stroke="currentColor" strokeDasharray="5 4" opacity={.55}/><text x={element.x+6} y={element.y+16} fontSize={11} fill="currentColor" opacity={.75}>{label}</text></g>;
}
