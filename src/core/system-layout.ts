import type { Project, Text } from '../core';

/** Presentation geometry derived from authored systems and equipment positions. */
export interface SystemEnvelope {
  readonly id:string; readonly label:Text; readonly parent?:string; readonly depth:number;
  readonly x:number; readonly y:number; readonly width:number; readonly height:number; readonly count:number;
}

export function systemLayout(project:Pick<Project,'systems'|'equipment'>):SystemEnvelope[] {
  const definitions=project.systems??[],byId=new Map(definitions.map(group=>[group.id,group])),byParent=new Map<string|undefined,typeof definitions[number][]>();
  for(const definition of definitions){const siblings=byParent.get(definition.parent)??[];siblings.push(definition);byParent.set(definition.parent,siblings);}
  const equipmentBySystem=new Map<string,typeof project.equipment>();
  for(const equipment of project.equipment)if(equipment.system){const members=equipmentBySystem.get(equipment.system)??[];members.push(equipment);equipmentBySystem.set(equipment.system,members);}
  const result:SystemEnvelope[]=[];
  const visit=(id:string,depth:number):SystemEnvelope|undefined=>{
    const definition=byId.get(id)!;
    const children=(byParent.get(id)??[]).map(child=>visit(child.id,depth+1)).filter((group):group is SystemEnvelope=>!!group);
    const members=equipmentBySystem.get(id)??[];
    const boxes=[...children,...members.map(equipment=>({
      x:equipment.x-8,y:equipment.y-48,
      width:(equipment.capabilities.diagram?.width??160)+16,
      height:(equipment.capabilities.diagram?.height??150)+76,
    }))];
    if(!boxes.length)return;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const box of boxes){minX=Math.min(minX,box.x);minY=Math.min(minY,box.y);maxX=Math.max(maxX,box.x+box.width);maxY=Math.max(maxY,box.y+box.height);}
    const x=minX-24,y=minY-76;
    const group:SystemEnvelope={id,label:definition.label,parent:definition.parent,depth,x,y,width:Math.max(214,maxX-x+24),height:maxY-y+24,count:members.length+children.reduce((sum,child)=>sum+child.count,0)};
    result.push(group);return group;
  };
  for(const root of byParent.get(undefined)??[])visit(root.id,0);
  return result.sort((a,b)=>a.depth-b.depth||a.id.localeCompare(b.id,'en'));
}

/** Two lines fit the same header width in 2D and 3D. */
export function systemTitleLines(title:string,width:number):string[] {
  const limit=Math.max(8,Math.floor((width-40)/9)),words=title.trim().split(/\s+/),lines:string[]=[];
  let current='';
  for(const word of words){if(current&&current.length+word.length+1>limit){lines.push(current);current=word;}else current+=(current?' ':'')+word;}
  if(current)lines.push(current);
  return lines.length<=2?lines:[lines[0]!,lines.slice(1).join(' ').slice(0,Math.max(1,limit-1))+'…'];
}
