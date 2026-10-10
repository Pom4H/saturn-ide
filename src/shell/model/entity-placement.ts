/** One shared model for click-to-place on 2D and 3D views. Position is the equipment origin. */
export interface PlacementPoint { readonly x:number; readonly y:number }
export interface PlacementExtent { readonly x:number;readonly y:number;readonly width:number;readonly height:number }
export const templateDimensions=(template:string):{width:number;height:number}=>
  template==='tee'?{width:80,height:80}:template==='custom'?{width:180,height:120}:{width:160,height:150};
export function placementAt(cursor:PlacementPoint, template:string, equipment:readonly PlacementExtent[],grid=20):PlacementPoint&{valid:boolean}{
  const {width,height}=templateDimensions(template);
  const x=Math.round((cursor.x-width/2)/grid)*grid,y=Math.round((cursor.y-height/2)/grid)*grid;
  const gap=12;
  const valid=[x,y].every(value=>Number.isFinite(value)&&Math.abs(value)<=999000)&&
    !equipment.some(e=>x<e.x+e.width+gap&&x+width+gap>e.x&&y<e.y+e.height+gap&&y+height+gap>e.y);
  return {x,y,valid};
}
const prefix:Readonly<Record<string,string>>={pump:'P',tank:'TK',valve:'V',tee:'T',plc:'PLC',custom:'DEVICE'};
/** Propose a stable human-editable tag; existing project entities and file paths are never overwritten. */
export function nextEntityId(template:string,ids:readonly string[]):string{
  const p=prefix[template]??'DEVICE',existing=new Set(ids);
  for(let i=1;i<=9999;i++){const id=`${p}-${String(i).padStart(2,'0')}`;if(!existing.has(id))return id;}
  throw new Error('Equipment tag range is exhausted');
}
