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

/** Flat files keep their real path and declarations; no synthesized folders or files. */
export function flatResourceFiles(catalog:ResourceCatalog):ResourceTreeNode[]{
 const files:ResourceTreeNode[]=[];const walk=(nodes:ResourceTreeNode[])=>{for(const node of nodes)if(node.kind==='directory')walk(node.children);else files.push(node);};walk(resourceTree(catalog));return files.sort((a,b)=>a.path.localeCompare(b.path,'en',{numeric:true}));
}
export function resourceFileIcon(resource:ProjectResource|undefined,path:string):string{
 if(resource&&resource.kind!=='file')return resource.icon;
 if(/\.md$/i.test(path))return 'docs';if(/(?:^|\/)(package|tsconfig)[^/]*\.json$/.test(path))return 'settings';
 if(/\.(json|ya?ml)$/.test(path))return 'settings';if(/\.(test|spec)\.tsx?$|^tests\//.test(path))return 'test';
 if(/(?:^|\/)(server|driver)\.ts$/.test(path))return 'terminal';if(/(?:^|\/)browser\.ts$/.test(path))return 'hmi';return 'source';
}
