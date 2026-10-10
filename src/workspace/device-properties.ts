import ts from 'typescript';
import { deviceCalls, numericLiteral } from './ast';
import { HttpError } from './files';

export interface DevicePropertiesPatch {
  readonly label?:string;
  readonly locale?:'ru'|'en';
  readonly x?:number;
  readonly y?:number;
  readonly z?:number;
  /** null detaches the device from its room, while keeping world-plan XY. */
  readonly system?:string|null;
}
interface TextEdit {readonly from:number;readonly to:number;readonly text:string}
const key=(node:ts.PropertyName,tree:ts.SourceFile)=>ts.isIdentifier(node)||ts.isStringLiteral(node)?node.text:node.getText(tree);
/** Edits one unambiguous authored equipment call by AST offsets; no regex replacement or second authored state. */
export function patchDeviceProperties(source:string,id:string,patch:DevicePropertiesPatch):string{
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/.test(id))throw new HttpError(400,'Invalid equipment id');
  if(patch.label!==undefined&&(typeof patch.label!=='string'||!patch.label.trim()||patch.label.length>160))throw new HttpError(400,'Invalid equipment label');
  for(const field of ['x','y','z'] as const)if(patch[field]!==undefined&&(!Number.isFinite(patch[field])||Math.abs(patch[field])>999000))throw new HttpError(400,`Invalid ${field} coordinate`);
  if(patch.system!==undefined&&patch.system!==null&&(!patch.system||patch.system.length>160))throw new HttpError(400,'Invalid system id');
  if(patch.locale!==undefined&&!['ru','en'].includes(patch.locale))throw new HttpError(400,'Invalid locale');
  const tree=ts.createSourceFile('equipment.ts',source,ts.ScriptTarget.Latest,true);
  const matches=deviceCalls(tree,new Set([id]));
  if(matches.length!==1)throw new HttpError(409,'Equipment source is missing or ambiguous; edit TypeScript directly');
  const options=matches[0]!.options,existing=new Map(options.properties.filter(ts.isPropertyAssignment).map(node=>[key(node.name,tree),node]));
  const edits:TextEdit[]=[],inserted:string[]=[];
  const property=(name:string,value:string,allowComputed=false)=>{
    const prop=existing.get(name);
    if(!prop){inserted.push(`${name}: ${value}`);return;}
    if(!allowComputed&&name==='label'&&!ts.isStringLiteralLike(prop.initializer))throw new HttpError(409,'Computed label is read-only in the inspector; edit TypeScript');
    if(!allowComputed&&['x','y','z'].includes(name)&&!numericLiteral(prop.initializer))throw new HttpError(409,`Computed ${name} is read-only in the inspector; edit TypeScript`);
    if(name==='system'&&!(ts.isStringLiteralLike(prop.initializer)||prop.initializer.kind===ts.SyntaxKind.UndefinedKeyword||prop.initializer.getText(tree)==='undefined'))throw new HttpError(409,'Computed system is read-only in the inspector; edit TypeScript');
    edits.push({from:prop.initializer.getStart(tree),to:prop.initializer.end,text:value});
  };
  if(patch.label!==undefined){
    const original=existing.get('label')?.initializer;
    if(original&&ts.isObjectLiteralExpression(original)){
      const lang=patch.locale??'ru',entry=original.properties.filter(ts.isPropertyAssignment).find(p=>key(p.name,tree)===lang);
      if(!entry||!ts.isStringLiteralLike(entry.initializer))throw new HttpError(409,'Computed localized label is read-only in the inspector; edit TypeScript');
      edits.push({from:entry.initializer.getStart(tree),to:entry.initializer.end,text:JSON.stringify(patch.label.trim())});
    }else property('label',JSON.stringify(patch.label.trim()));
  }
  for(const name of ['x','y','z'] as const)if(patch[name]!==undefined)property(name,String(Math.round(patch[name]!)));
  if(patch.system!==undefined)property('system',patch.system===null?'undefined':JSON.stringify(patch.system));
  if(inserted.length){
    const comma=options.properties.length&&!options.properties.hasTrailingComma?',':'';
    edits.push({from:options.end-1,to:options.end-1,text:`${comma}\n  ${inserted.join(',\n  ')},\n`});
  }
  let output=source,last=source.length;
  for(const edit of edits.sort((a,b)=>b.from-a.from)){
    if(edit.to>last)throw new HttpError(409,'Overlapping device edits');
    output=output.slice(0,edit.from)+edit.text+output.slice(edit.to);last=edit.from;
  }
  return output;
}
