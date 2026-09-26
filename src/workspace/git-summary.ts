import ts from 'typescript';
import type {GitMeaning} from '../core/git';
import {asDeviceCall} from './ast';
interface Declaration {key:string;kind:GitMeaning['kind'];id:string;path:string;fields:Map<string,string>}
export interface SourcePair {path:string;before:string;after:string}
const printer=ts.createPrinter({removeComments:true});
function declarations(path:string,source:string):Declaration[]{
 const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),result:Declaration[]=[];
 const factories=new Map<string,string>();
 for(const statement of tree.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)&&statement.moduleSpecifier.text==='@saturn/core'){
  const bindings=statement.importClause?.namedBindings;if(bindings&&ts.isNamedImports(bindings))for(const item of bindings.elements)factories.set(item.name.text,item.propertyName?.text??item.name.text);
 }
 const literal=(node:ts.Node)=>{if(ts.isPrefixUnaryExpression(node)&&ts.isNumericLiteral(node.operand))return printer.printNode(ts.EmitHint.Expression,node,tree);if(ts.isStringLiteralLike(node))return JSON.stringify(node.text);const printed=printer.printNode(ts.EmitHint.Unspecified,node,tree),scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,printed),tokens:string[]=[];let token:ts.SyntaxKind;while((token=scanner.scan())!==ts.SyntaxKind.EndOfFileToken)tokens.push(token===ts.SyntaxKind.StringLiteral?JSON.stringify(scanner.getTokenValue()):scanner.getTokenText());return tokens.join(' ');};
 const fields=(object:ts.ObjectLiteralExpression,prefix='',out=new Map<string,string>())=>{
  for(const item of object.properties){if(ts.isPropertyAssignment(item)&&!ts.isComputedPropertyName(item.name)){
   const name=(ts.isIdentifier(item.name)||ts.isStringLiteralLike(item.name)?item.name.text:item.name.getText(tree)),key=prefix+name;
   if(ts.isObjectLiteralExpression(item.initializer))fields(item.initializer,key+'.',out);else out.set(key,literal(item.initializer));
  }else out.set(prefix+'…'+out.size,literal(item));}return out;
 };
 const kinds:Record<string,GitMeaning['kind']>={signal:'signal',pipe:'connection',cable:'connection',alarm:'alarm',report:'report',queryReport:'report',hmi:'hmi',project:'project'};
 const visit=(node:ts.Node)=>{
  if(ts.isCallExpression(node)){
   const device=asDeviceCall(node,tree),factory=ts.isIdentifier(node.expression)?factories.get(node.expression.text):undefined,kind=device?'equipment':factory?kinds[factory]:undefined;
   const [first,second]=node.arguments,object=device?.options??(second&&ts.isObjectLiteralExpression(second)?second:first&&ts.isObjectLiteralExpression(first)?first:undefined);
   if(kind&&object){const values=fields(object),id=device?.id??(first&&ts.isStringLiteralLike(first)?first.text:kind==='project'?values.get('id')?.replace(/^"|"$/g,''):undefined);
    if(id){values.set('$factory',factory??literal(node.expression));const identity=values.get('semanticId')??JSON.stringify(id);result.push({key:kind+':'+identity,kind,id,path,fields:values});}
   }
  }
  ts.forEachChild(node,visit);
 };visit(tree);return result;
}
/** Partial syntax summary. Raw diff remains authoritative for computed/imported behavior and unrecognized code. */
export function summarizeSources(sources:readonly SourcePair[]):GitMeaning[]{
 const before=sources.flatMap(s=>declarations(s.path,s.before)),after=sources.flatMap(s=>declarations(s.path,s.after));
 const unique=(items:Declaration[])=>{const map=new Map<string,Declaration>();for(const item of items){const key=items.filter(other=>other.key===item.key).length===1?item.key:item.key+':'+item.path;map.set(key,item);}return map;};
 const a=unique(before),b=unique(after),result:GitMeaning[]=[];
 for(const key of new Set([...a.keys(),...b.keys()])){const old=a.get(key),next=b.get(key),item=next??old!;
  if(!old||!next){result.push({kind:item.kind,id:item.id,path:item.path,type:next?'added':'removed',fields:[]});continue;}
  const changes=[...new Set([...old.fields.keys(),...next.fields.keys()])].filter(name=>old.fields.get(name)!==next.fields.get(name)).map(name=>({name,before:old.fields.get(name),after:next.fields.get(name)}));
  if(old.id!==next.id)changes.unshift({name:'id',before:old.id,after:next.id});
  if(old.path!==next.path)changes.push({name:'$file',before:old.path,after:next.path});
  if(changes.length)result.push({kind:item.kind,id:item.id,path:item.path,type:old.id!==next.id?'renamed':'changed',fields:changes});
 }
 return result;
}
