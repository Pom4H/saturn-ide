import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { SaturnHmiCommand, SaturnHmiFrame } from './frame';

export const color565=(c:number)=>`rgb(${Math.round((c>>11&31)*255/31)},${Math.round((c>>5&63)*255/63)},${Math.round((c&31)*255/31)})`;

const sourceProps=(command:SaturnHmiCommand)=>command.source?{'data-source':command.source}:{};
const points=(value:{x:number;y:number}[])=>value.map(point=>`${point.x},${point.y}`).join(' ');

function commandElement(command:SaturnHmiCommand,index:number):React.ReactNode {
  const common={key:index,...sourceProps(command),opacity:command.opacity};
  switch(command.type){
    case'rect':return React.createElement('rect',{...common,x:command.x,y:command.y,width:command.width,height:command.height,rx:command.radius,fill:color565(command.fill),stroke:command.stroke===undefined?undefined:color565(command.stroke),strokeWidth:command.strokeWidth});
    case'circle':return React.createElement('circle',{...common,cx:command.cx,cy:command.cy,r:command.r,fill:color565(command.fill),stroke:command.stroke===undefined?undefined:color565(command.stroke),strokeWidth:command.strokeWidth});
    case'line':return React.createElement('line',{...common,x1:command.x1,y1:command.y1,x2:command.x2,y2:command.y2,stroke:color565(command.color),strokeWidth:command.width,strokeLinecap:'round'});
    case'polyline':return React.createElement('polyline',{...common,points:points(command.points),fill:'none',stroke:color565(command.color),strokeWidth:command.width,strokeLinecap:'round',strokeLinejoin:'round'});
    case'polygon':return React.createElement('polygon',{...common,points:points(command.points),fill:color565(command.fill)});
    case'text':return React.createElement('text',{...common,x:command.x,y:command.y,fill:color565(command.color),fontSize:command.size,fontWeight:command.weight,textAnchor:command.align==='start'?'start':command.align==='middle'?'middle':'end',fontFamily:command.mono?'ui-monospace, SFMono-Regular, Menlo, monospace':'Inter, ui-sans-serif, system-ui, sans-serif',dominantBaseline:'hanging'},command.text);
  }
}

export function SaturnHmi320({frame}:{frame:SaturnHmiFrame}):React.ReactElement {
  return React.createElement(React.Fragment,null,...frame.commands.map(commandElement));
}

function renderInto(svg:SVGSVGElement,root:Root,frame:SaturnHmiFrame):void {
  svg.setAttribute('viewBox','0 0 320 240');
  svg.setAttribute('data-time-ms',String(frame.timeMs));
  flushSync(()=>root.render(React.createElement(SaturnHmi320,{frame})));
}

const roots=new WeakMap<SVGSVGElement,Root>();
export function renderHmiReact(svg:SVGSVGElement,frame:SaturnHmiFrame):void {
  let root=roots.get(svg);if(!root){root=createRoot(svg);roots.set(svg,root);}
  renderInto(svg,root,frame);
}

interface CanvasProjection { svg:SVGSVGElement; root:Root; key:string }
const canvasProjections=new WeakMap<HTMLCanvasElement,CanvasProjection>();
export function renderHmiReactCanvas(canvas:HTMLCanvasElement,frame:SaturnHmiFrame,onRendered?:()=>void):void {
  const key=JSON.stringify(frame);let projection=canvasProjections.get(canvas);
  if(!projection){
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('xmlns','http://www.w3.org/2000/svg');svg.setAttribute('width','320');svg.setAttribute('height','240');
    projection={svg,root:createRoot(svg),key:''};canvasProjections.set(canvas,projection);
  }
  if(projection.key===key)return;projection.key=key;
  renderInto(projection.svg,projection.root,frame);
  const markup=new XMLSerializer().serializeToString(projection.svg);
  const image=new Image();
  image.onload=()=>{
    const context=canvas.getContext('2d');if(!context)return;
    context.clearRect(0,0,canvas.width,canvas.height);
    context.drawImage(image,0,0,canvas.width,canvas.height);
    onRendered?.();
  };
  image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(markup);
}
