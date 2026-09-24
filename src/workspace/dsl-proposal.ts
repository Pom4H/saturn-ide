import ts from 'typescript';
import type { DslChange, DslTarget } from '../core/feedback';
interface Target extends DslTarget {from:number;to:number}
const prop=(node:ts.ObjectLiteralExpression,name:string)=>{
  if(node.properties.some(p=>ts.isSpreadAssignment(p)))return undefined;
  const matches=node.properties.filter((p):p is ts.PropertyAssignment=>ts.isPropertyAssignment(p)&&!ts.isComputedPropertyName(p.name)&&(ts.isIdentifier(p.name)||ts.isStringLiteral(p.name))&&p.name.text===name);
  return matches.length===1?matches[0]!.initializer:undefined;
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
  // Project-authored files only. No plugin, firmware, protocol, CI or dependency edits.
  if(!/^(?:[a-zA-Z0-9_-]+\/)*(?:project\.ts|equipment\/[a-zA-Z0-9_./-]+\.device\.ts)$/.test(path)||path.split('/').some(p=>['plugins','firmware','node_modules','targets'].includes(p)||p==='..'))return [];
  const tree=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),result:Target[]=[];
  const imports=new Map<string,string>();
  for(const statement of tree.statements)if(ts.isImportDeclaration(statement)&&ts.isStringLiteral(statement.moduleSpecifier)&&['@saturn/core','saturn-ide/core'].includes(statement.moduleSpecifier.text)){
    const bindings=statement.importClause?.namedBindings;if(bindings&&ts.isNamedImports(bindings))for(const e of bindings.elements)imports.set(e.name.text,e.propertyName?.text??e.name.text);
  }
  const add=(kind:DslTarget['kind'],id:string,node:ts.Node|undefined,locale?:'ru'|'en')=>{const value=literal(node);if(node&&value!==undefined)result.push({kind,id,path,locale,value,from:node.getStart(tree),to:node.end});};
  const visit=(node:ts.Node)=>{
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)){
      const [first,second]=node.arguments;
      if(first&&ts.isStringLiteral(first)&&second&&ts.isObjectLiteralExpression(second)){
        if(imports.get(node.expression.text)==='alarm')add('alarm.above',first.text,prop(second,'above'));
        else if(path.endsWith('.device.ts')&&typeof literal(prop(second,'semanticId'))==='string'&&String(literal(prop(second,'semanticId'))).startsWith('equipment:')){
          const label=prop(second,'label');if(label&&ts.isObjectLiteralExpression(label))for(const locale of ['ru','en'] as const)add('equipment.label',first.text,prop(label,locale),locale);
          for(const field of second.properties)if(ts.isPropertyAssignment(field)&&ts.isIdentifier(field.name)){
            let initializer=field.initializer;
            // Protocol binding preserves the same owned signal; only change its literal initial value.
            if(ts.isCallExpression(initializer)&&ts.isPropertyAccessExpression(initializer.expression)&&initializer.expression.name.text==='bind'&&initializer.arguments[0])initializer=initializer.arguments[0];
            if(ts.isCallExpression(initializer)&&ts.isIdentifier(initializer.expression)&&imports.get(initializer.expression.text)==='signal'){
              const options=initializer.arguments[0];if(options&&ts.isObjectLiteralExpression(options))add('signal.initial',`${first.text}.${field.name.text}`,prop(options,'initial'));
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
