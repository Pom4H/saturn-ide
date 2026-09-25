import type { ProjectResource, ResourceCatalog } from '../../core/resources';

/** A derived explorer projection. Paths come only from the workspace resource catalog. */
export interface ResourceTreeNode {
  id:string; name:string; path:string; kind:'directory'|'file'|'entity';
  resource?:ProjectResource; children:ResourceTreeNode[];
}
export function resourceTree(catalog:ResourceCatalog):ResourceTreeNode[] {
  const roots:ResourceTreeNode[]=[],directories=new Map<string,ResourceTreeNode>();
  const files=new Map<string,ProjectResource[]>();
  for(const resource of catalog.resources)if(resource.source){const path=resource.source.path;files.set(path,[...files.get(path)??[],resource]);}
  for(const [path,resources] of files){
    const parts=path.split('/'),name=parts.pop()!;let children=roots,prefix='';
    for(const part of parts){prefix=prefix?`${prefix}/${part}`:part;let directory=directories.get(prefix);
      if(!directory){directory={id:`directory:${prefix}`,name:part,path:prefix,kind:'directory',children:[]};directories.set(prefix,directory);children.push(directory);}
      children=directory.children;
    }
    const resource=resources.find(item=>item.kind==='file')??resources.find(item=>item.kind==='project')??resources[0]!;
    children.push({id:`file:${path}`,name,path,kind:'file',resource,children:resources.filter(item=>item.kind==='device'||item.kind==='report').map(item=>({id:`entity:${item.uri}`,name:item.entityId??item.name.en,path,kind:'entity',resource:item,children:[]}))});
  }
  const sort=(nodes:ResourceTreeNode[])=>{nodes.sort((a,b)=>Number(b.kind==='directory')-Number(a.kind==='directory')||a.name.localeCompare(b.name,'en',{numeric:true}));for(const node of nodes)sort(node.children);};
  sort(roots);return roots;
}
