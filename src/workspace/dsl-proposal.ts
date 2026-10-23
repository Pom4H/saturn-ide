import ts from 'typescript';
import type { DslChange, DslTarget } from '../core/feedback';
import { asDeviceCall, authoredProperty } from './ast';
interface Target extends DslTarget {from:number;to:number}
const prop=(node:ts.ObjectLiteralExpression,name:string)=>{
  const found=authoredProperty(node,name);
  return found.kind==='explicit'?found.node.initializer:undefined;
};
/** Source proposals may edit authored modules, not executable adapters or vendor internals. */
const authoredPath=(path:string)=>{
  const parts=path.split('/'),file=parts.at(-1)??'';
  return path.length<=512&&!/[\\:\0]/.test(path)&&/\.tsx?$/.test(file.toLowerCase())&&!/\.(?:test|spec|d)\.tsx?$/.test(file.toLowerCase())&&
    !/^(?:server|browser|driver)\.tsx?$/.test(file.toLowerCase())&&
    parts.every(part=>!!part&&!part.startsWith('.')&&!['plugins','firmware','node_modules','targets','protocols','tests','scripts'].includes(part.toLowerCase()));
};
const literal=(node:ts.Node|undefined):string|number|boolean|undefined=>{
  if(!node)return;
  if(ts.isStringLiteral(node))return node.text;
  if(ts.isNumericLiteral(node))return Number(node.text);
  if(node.kind===ts.SyntaxKind.TrueKeyword)return true;
  if(node.kind===ts.SyntaxKind.FalseKeyword)return false;
  if(ts.isPrefixUnaryExpression(node)&&node.operator===ts.SyntaxKind.MinusToken&&ts.isNumericLiteral(node.operand))return -Number(node.operand.text);
};
function targets(path:string,source:string):Target[]{
  if(!authoredPath(path))return [];
  const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),result:Target[]=[];
  const imports=new Map<string,string>(),namespaces=new Set<string>();
  for(const statement of tree.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)&&['@saturn/core','saturn-ide/core'].includes(statement.moduleSpecifier.text)){
    const clause=statement.importClause;if(!clause||clause.isTypeOnly)continue;
    const bindings=clause.namedBindings;
    if(bindings&&ts.isNamedImports(bindings))for(const e of bindings.elements){if(!e.isTypeOnly)imports.set(e.name.text,e.propertyName?.text??e.name.text);}
    else if(bindings&&ts.isNamespaceImport(bindings))namespaces.add(bindings.name.text);
  }
  const coreCall=(expression:ts.Expression):string|undefined=>ts.isIdentifier(expression)?imports.get(expression.text):
    ts.isPropertyAccessExpression(expression)&&ts.isIdentifier(expression.expression)&&namespaces.has(expression.expression.text)?expression.name.text:undefined;
  const add=(kind:DslTarget['kind'],id:string,node:ts.Node|undefined,locale?:'ru'|'en')=>{const value=literal(node);if(node&&value!==undefined)result.push({kind,id,path,...(locale?{locale}:{}),value,from:node.getStart(tree),to:node.end});};
  const visit=(node:ts.Node)=>{
    if(ts.isFunctionLike(node))return; // Shared factory implementation is not an instance override.
    if(ts.isCallExpression(node)){
      const [first,second]=node.arguments;
      if(first&&ts.isStringLiteral(first)&&second&&ts.isObjectLiteralExpression(second)){
        if(coreCall(node.expression)==='alarm')add('alarm.above',first.text,prop(second,'above'));
        else if(asDeviceCall(node,tree)||typeof literal(prop(second,'semanticId'))==='string'&&String(literal(prop(second,'semanticId'))).startsWith('equipment:')){
          const label=prop(second,'label');
          if(label&&ts.isStringLiteral(label))add('equipment.label',first.text,label);
          else if(label&&ts.isObjectLiteralExpression(label))for(const locale of ['ru','en'] as const)add('equipment.label',first.text,prop(label,locale),locale);
          for(const field of second.properties)if(ts.isPropertyAssignment(field)&&(ts.isIdentifier(field.name)||ts.isStringLiteral(field.name))){
            const owned=authoredProperty(second,field.name.text);
            if(owned.kind!=='explicit'||owned.node!==field)continue;
            let initializer=field.initializer;
            // Bind is the imported core function, never an arbitrary object's method.
            while(ts.isCallExpression(initializer)&&coreCall(initializer.expression)==='bind'&&initializer.arguments[0])initializer=initializer.arguments[0];
            if(ts.isCallExpression(initializer)&&coreCall(initializer.expression)==='signal'){
              const [firstArg,secondArg]=initializer.arguments;
              const explicitId=firstArg&&ts.isStringLiteral(firstArg)?firstArg.text:undefined;
              const options=explicitId!==undefined?secondArg:firstArg;
              if(options&&ts.isObjectLiteralExpression(options))add('signal.initial',explicitId??`${first.text}.${field.name.text}`,prop(options,'initial'));
            }
          }
        }
      }
    }
    ts.forEachChild(node,visit);
  };visit(tree);return result;
}
export function dslCatalog(files:Record<string,string>):DslTarget[]{return Object.entries(files).flatMap(([path,source])=>targets(path,source).map(({from,to,...target})=>target));}
export function applyDslProposal(files:Record<string,string>,changes:readonly DslChange[]):Record<string,string>{
  if(!changes.length||changes.length>8)throw new Error('Expected 1–8 DSL operations');
  const all=Object.entries(files).flatMap(([path,source])=>targets(path,source));
  const edits=new Map<string,{from:number;to:number;value:string}[]>(),seen=new Set<string>();
  for(const change of changes){
    const matches=all.filter(t=>t.kind===change.kind&&t.id===change.id&&(change.kind!=='equipment.label'||t.locale===change.locale));
    if(matches.length!==1)throw new Error(`Unknown or ambiguous DSL target: ${change.id}`);
    const target=matches[0]!,key=`${target.path}:${target.from}`;
    if(seen.has(key))throw new Error('Duplicate DSL operation');seen.add(key);
    if(typeof change.value!==typeof target.value||typeof change.value==='number'&&!Number.isFinite(change.value)||typeof change.value==='string'&&change.value.length>240)throw new Error('Invalid DSL value');
    const list=edits.get(target.path)??[];list.push({from:target.from,to:target.to,value:JSON.stringify(change.value)});edits.set(target.path,list);
  }
  return Object.fromEntries([...edits].map(([path,list])=>{let source=files[path]!;for(const edit of list.sort((a,b)=>b.from-a.from))source=source.slice(0,edit.from)+edit.value+source.slice(edit.to);return [path,source];}));
}
