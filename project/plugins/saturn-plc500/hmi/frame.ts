export type HmiColor = number;
export interface HmiBinding { signal:string; scale?:number; offset?:number; min?:number; max?:number; fallback?:number }
export interface HmiPoint { x:number; y:number }
interface HmiBase { id?:string; visible?:HmiBinding; visibleAbove?:number }
export type HmiFrameNode =
  | (HmiBase & {kind:'rect';x:number;y:number;width:number;height:number;fill:HmiColor;stroke?:HmiColor;strokeWidth?:number;radius?:number;opacity?:number})
  | (HmiBase & {kind:'circle';cx:number;cy:number;r:number;fill:HmiColor;stroke?:HmiColor;strokeWidth?:number;opacity?:number})
  | (HmiBase & {kind:'line';x1:number;y1:number;x2:number;y2:number;color:HmiColor;width?:number;opacity?:number})
  | (HmiBase & {kind:'text';x:number;y:number;text:string|{value:HmiBinding;prefix?:string;suffix?:string;digits?:number;on?:string;off?:string};color:HmiColor;size?:number;weight?:number;align?:'start'|'middle'|'end';mono?:boolean})
  | (HmiBase & {kind:'tank';x:number;y:number;width:number;height:number;level:HmiBinding;shell:HmiColor;background:HmiColor;water:HmiColor;waterLine?:HmiColor;strokeWidth?:number;waveAmplitude?:number;waveLength?:number;waveSpeed?:number;radius?:number})
  | (HmiBase & {kind:'pump';cx:number;cy:number;r:number;rpm:HmiBinding;shell:HmiColor;body:HmiColor;bladeA:HmiColor;bladeB?:HmiColor;hub:HmiColor;bladeCount?:number})
  | (HmiBase & {kind:'flow';points:HmiPoint[];value:HmiBinding;background:HmiColor;color:HmiColor;width?:number;backgroundWidth?:number;packetRadius?:number;packetSpacing?:number;speed?:number;threshold?:number})
  | (HmiBase & {kind:'lamp';cx:number;cy:number;r:number;value:HmiBinding;off:HmiColor;on:HmiColor;highlight?:HmiColor;halo?:HmiColor;stroke?:HmiColor;pulseHz?:number});

export interface SaturnHmiScene { width?:320; height?:240; background:HmiColor; nodes:readonly HmiFrameNode[] }
interface DrawBase { opacity?:number; source?:string }
export type SaturnHmiCommand =
  | (DrawBase & {type:'rect';x:number;y:number;width:number;height:number;fill:HmiColor;stroke?:HmiColor;strokeWidth?:number;radius?:number})
  | (DrawBase & {type:'circle';cx:number;cy:number;r:number;fill:HmiColor;stroke?:HmiColor;strokeWidth?:number})
  | (DrawBase & {type:'line';x1:number;y1:number;x2:number;y2:number;color:HmiColor;width:number})
  | (DrawBase & {type:'polyline';points:HmiPoint[];color:HmiColor;width:number})
  | (DrawBase & {type:'polygon';points:HmiPoint[];fill:HmiColor})
  | (DrawBase & {type:'text';x:number;y:number;text:string;color:HmiColor;size:number;weight:number;align:'start'|'middle'|'end';mono:boolean});
export interface SaturnHmiFrame { width:320;height:240;timeMs:number;commands:SaturnHmiCommand[] }
export type HmiSignals = Readonly<Record<string,number|null|undefined>>;

const TAU=Math.PI*2;
const clamp=(v:number,min:number,max:number)=>Math.max(min,Math.min(max,v));
const op=(v:number|undefined)=>v===undefined?1:clamp(Number.isFinite(v)?v:1,0,1);
const resolve=(b:HmiBinding,s:HmiSignals)=>{
  const raw=s[b.signal]; let v=typeof raw==='number'&&Number.isFinite(raw)?raw:(b.fallback??0);
  v=v*(b.scale??1)+(b.offset??0);
  if(b.min!==undefined)v=Math.max(b.min,v);if(b.max!==undefined)v=Math.min(b.max,v);return v;
};
const visible=(n:HmiFrameNode,s:HmiSignals)=>!n.visible||resolve(n.visible,s)>(n.visibleAbove??0);
const rotate=(p:HmiPoint,cx:number,cy:number,a:number):HmiPoint=>{const dx=p.x-cx,dy=p.y-cy,c=Math.cos(a),sn=Math.sin(a);return{x:cx+dx*c-dy*sn,y:cy+dx*sn+dy*c};};
const length=(p:readonly HmiPoint[])=>p.slice(1).reduce((t,b,i)=>t+Math.hypot(b.x-p[i]!.x,b.y-p[i]!.y),0);
const pointAt=(points:readonly HmiPoint[],distance:number):HmiPoint=>{
  if(!points.length)return{x:0,y:0};if(points.length===1)return{...points[0]!};
  const total=length(points);if(total<=0)return{...points[0]!};let target=((distance%total)+total)%total;
  for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,l=Math.hypot(b.x-a.x,b.y-a.y);if(target<=l||i===points.length-1){const t=l?clamp(target/l,0,1):0;return{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};}target-=l;}
  return{...points[points.length-1]!};
};
const phase=(timeMs:number,radiansPerMs:number)=>((timeMs*radiansPerMs)%TAU+TAU)%TAU;

export function renderSaturnHmi(scene:SaturnHmiScene,signals:HmiSignals,timeMs:number):SaturnHmiFrame {
  if(!Number.isFinite(timeMs)||timeMs<0)throw new Error('Saturn HMI time must be finite and non-negative');
  if(scene.width!==undefined&&scene.width!==320||scene.height!==undefined&&scene.height!==240)throw new Error('Saturn HMI must be 320x240');
  if(scene.nodes.length>256)throw new Error('Saturn HMI scene exceeds 256 nodes');
  const commands:SaturnHmiCommand[]=[{type:'rect',x:0,y:0,width:320,height:240,fill:scene.background}];
  let source:string|undefined;
  const push=(c:SaturnHmiCommand)=>{if(commands.length>=1024)throw new Error('Saturn HMI frame exceeds 1024 commands');commands.push(source?{...c,source}:c);};
  scene.nodes.forEach((node,index)=>{
    if(!visible(node,signals))return;source=node.id??node.kind+':'+index;
    switch(node.kind){
      case'rect':push({type:'rect',x:node.x,y:node.y,width:node.width,height:node.height,fill:node.fill,...(node.stroke===undefined?{}:{stroke:node.stroke}),...(node.strokeWidth===undefined?{}:{strokeWidth:node.strokeWidth}),...(node.radius===undefined?{}:{radius:node.radius}),opacity:op(node.opacity)});break;
      case'circle':push({type:'circle',cx:node.cx,cy:node.cy,r:node.r,fill:node.fill,...(node.stroke===undefined?{}:{stroke:node.stroke}),...(node.strokeWidth===undefined?{}:{strokeWidth:node.strokeWidth}),opacity:op(node.opacity)});break;
      case'line':push({type:'line',x1:node.x1,y1:node.y1,x2:node.x2,y2:node.y2,color:node.color,width:node.width??1,opacity:op(node.opacity)});break;
      case'text':{let text:string;if(typeof node.text==='string')text=node.text;else{const v=resolve(node.text.value,signals);text=(node.text.prefix??'')+(node.text.on!==undefined&&node.text.off!==undefined?(v!==0?node.text.on:node.text.off):v.toFixed(node.text.digits??0))+(node.text.suffix??'');}push({type:'text',x:node.x,y:node.y,text,color:node.color,size:node.size??10,weight:node.weight??600,align:node.align??'start',mono:node.mono??false});break;}
      case'tank':{const level=clamp(resolve(node.level,signals),0,1),sw=node.strokeWidth??2,r=node.radius??8,pad=Math.max(4,sw+3),innerH=Math.max(0,node.height-pad*2),waterH=innerH*level,waterY=node.y+node.height-pad-waterH;push({type:'rect',x:node.x,y:node.y,width:node.width,height:node.height,fill:node.background,stroke:node.shell,strokeWidth:sw,radius:r});if(waterH>0)push({type:'rect',x:node.x+pad,y:waterY,width:Math.max(0,node.width-pad*2),height:waterH,fill:node.water,radius:Math.max(2,r/2)});if(level>0&&node.waterLine!==undefined){const pts:HmiPoint[]=[];for(let x=node.x+pad;x<=node.x+node.width-pad;x+=4)pts.push({x,y:waterY+Math.sin((x-node.x)/(node.waveLength??22)*TAU+timeMs*(node.waveSpeed??.006))*(node.waveAmplitude??2.5)});push({type:'polyline',points:pts,color:node.waterLine,width:2});}break;}
      case'pump':{const rpm=Math.max(0,resolve(node.rpm,signals)),angle=phase(timeMs,rpm/60000*TAU),count=clamp(Math.round(node.bladeCount??6),3,12);push({type:'circle',cx:node.cx,cy:node.cy,r:node.r+5,fill:node.shell});push({type:'circle',cx:node.cx,cy:node.cy,r:node.r,fill:node.body,stroke:node.bladeA,strokeWidth:1});for(let i=0;i<count;i++){const a=angle+i/count*TAU,p0={x:node.cx+node.r*.14,y:node.cy-node.r*.04},p1={x:node.cx+node.r*.80,y:node.cy-node.r*.28},p2={x:node.cx+node.r*.74,y:node.cy+node.r*.12},p3={x:node.cx+node.r*.22,y:node.cy+node.r*.18};push({type:'polygon',points:[p0,p1,p2,p3].map(p=>rotate(p,node.cx,node.cy,a)),fill:i%2===0?node.bladeA:(node.bladeB??node.bladeA)});}push({type:'circle',cx:node.cx,cy:node.cy,r:node.r*.16,fill:node.hub});break;}
      case'flow':{if(node.points.length<2)break;const value=resolve(node.value,signals),active=Math.abs(value)>(node.threshold??.001),total=length(node.points);push({type:'polyline',points:node.points.map(p=>({...p})),color:node.background,width:node.backgroundWidth??Math.max(6,(node.width??3)+4)});if(active){push({type:'polyline',points:node.points.map(p=>({...p})),color:node.color,width:node.width??3,opacity:.92});const spacing=Math.max(10,node.packetSpacing??22),offset=timeMs/1000*(node.speed??48)*Math.max(.2,Math.abs(value)),count=Math.min(32,Math.max(1,Math.floor(total/spacing)));for(let i=0;i<count;i++){const p=pointAt(node.points,(value<0?-1:1)*(offset+i*spacing));push({type:'circle',cx:p.x,cy:p.y,r:node.packetRadius??2.6,fill:node.color,opacity:.96});}}break;}
      case'lamp':{const value=clamp(resolve(node.value,signals),0,1),on=value>.001,pulse=on?.72+.18*Math.sin(timeMs/1000*(node.pulseHz??1.25)*TAU):0;if(on&&node.halo!==undefined)push({type:'circle',cx:node.cx,cy:node.cy,r:node.r*1.65,fill:node.halo,opacity:pulse*value});push({type:'circle',cx:node.cx,cy:node.cy,r:node.r,fill:on?node.on:node.off,...(node.stroke===undefined?{}:{stroke:node.stroke,strokeWidth:2})});if(on&&node.highlight!==undefined)push({type:'circle',cx:node.cx-node.r*.28,cy:node.cy-node.r*.3,r:node.r*.18,fill:node.highlight,opacity:.78});break;}
    }
  });
  return{width:320,height:240,timeMs,commands};
}
