import ts from 'typescript';
import type { Problem } from '../core';
import { deviceCalls, numericLiteral } from './ast';
import type { Workspace } from './files';

interface DomainError { code:string; messages:{en:string;ru:string} }
interface SourceRange { path:string; from:number; to:number }

/** Bundled project code has its own ProjectError constructor, so use the existing
 * code/messages contract instead of instanceof against the host's core module. */
function domainError(error:unknown):DomainError|undefined {
  if(!error||typeof error!=='object'||!('code' in error)||!('messages' in error))return;
  const code=error.code,messages=error.messages;
  if(typeof code!=='string'||!/^[A-Z][A-Z0-9_]*$/.test(code)||!messages||typeof messages!=='object'||!('en' in messages)||!('ru' in messages)||typeof messages.en!=='string'||typeof messages.ru!=='string')return;
  return {code,messages:{en:messages.en,ru:messages.ru}};
}

function referencedId(error:DomainError):{kind:'equipment'|'connection';id:string}|undefined {
  const en=error.messages.en;
  if(error.code==='POSITION'){
    const match=/^Invalid position ([a-zA-Z0-9_.-]+)$/.exec(en);
    return match?{kind:'equipment',id:match[1]!}:undefined;
  }
  const connection:Record<string,RegExp>={
    PORT_MEDIUM:/^Incompatible ports ([a-zA-Z0-9_.-]+)$/,
    PORT_QUANTITY:/^Incompatible quantities ([a-zA-Z0-9_.-]+)$/,
    PORT_DIRECTION:/^Wrong direction ([a-zA-Z0-9_.-]+)$/,
    PORT_VALUE_TYPE:/^Wrong signal type on ([a-zA-Z0-9_.-]+)$/,
    PORT_UNIT:/^Wrong signal unit on ([a-zA-Z0-9_.-]+)$/,
    CONNECTION_FREE_END:/^Invalid free end ([a-zA-Z0-9_.-]+)$/,
    CONNECTION_LEGACY:/^Legacy connection ends remain on ([a-zA-Z0-9_.-]+)$/,
  };
  const match=connection[error.code]?.exec(en);
  return match?{kind:'connection',id:match[1]!}:undefined;
}

/** Only attach a source range when the structural authored call is unambiguous.
 * Computed expressions and multiple declarations keep the domain message but no guessed range. */
function locate(workspace:Workspace,reference:ReturnType<typeof referencedId>):SourceRange|undefined {
  if(!reference)return;
  const matches:{path:string;tree:ts.SourceFile;call:ts.CallExpression;x?:ts.Expression;y?:ts.Expression}[]=[];
  for(const path of workspace.list().filter(path=>/\.tsx?$/.test(path))){
    const tree=ts.createSourceFile(path,workspace.read(path).source,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
    if(reference.kind==='equipment')for(const found of deviceCalls(tree,new Set([reference.id])))matches.push({path,tree,call:found.call,x:found.x,y:found.y});
    else{
      const visit=(node:ts.Node)=>{
        if(ts.isCallExpression(node)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])&&node.arguments[0].text===reference.id&&node.arguments[1]&&ts.isObjectLiteralExpression(node.arguments[1]))matches.push({path,tree,call:node});
        ts.forEachChild(node,visit);
      };
      visit(tree);
    }
  }
  if(matches.length!==1)return;
  const found=matches[0]!;
  if(reference.kind==='equipment'){
    const invalid=[found.x,found.y].filter((value):value is ts.Expression=>!!value&&numericLiteral(value)&&Math.abs(Number(value.getText(found.tree).replaceAll('_','')))>15000);
    if(invalid.length===1)return {path:found.path,from:invalid[0]!.getStart(found.tree),to:invalid[0]!.end};
  }
  return {path:found.path,from:found.call.getStart(found.tree),to:found.call.end};
}

export function projectErrorProblem(error:unknown,workspace:Workspace):Problem|undefined {
  const domain=domainError(error);if(!domain)return;
  return {code:domain.code,message:domain.messages,...locate(workspace,referencedId(domain))};
}
