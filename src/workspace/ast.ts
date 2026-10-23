import ts from 'typescript';

export interface DeviceCall {
  readonly id:string;
  readonly call:ts.CallExpression;
  readonly idLiteral:ts.StringLiteral;
  readonly options:ts.ObjectLiteralExpression;
  readonly x:ts.Expression;
  readonly y:ts.Expression;
}
export type AuthoredProperty =
  | { readonly kind:'explicit'; readonly node:ts.PropertyAssignment }
  | { readonly kind:'missing'|'ambiguous' };
/** Resolve an inverse-edit target without executing defaults or computed keys.
 * A later explicit field overrides a spread; a later spread may override the field.
 * Duplicate named fields and shorthand/accessors are never guessed. */
export function authoredProperty(object:ts.ObjectLiteralExpression,name:string):AuthoredProperty {
  let selected:ts.PropertyAssignment|undefined,unknown=false,seen=false;
  for(const member of object.properties){
    if(ts.isSpreadAssignment(member)||ts.isComputedPropertyName(member.name)){
      selected=undefined;unknown=true;continue;
    }
    if(!(ts.isIdentifier(member.name)||ts.isStringLiteral(member.name)||ts.isNumericLiteral(member.name))||member.name.text!==name)continue;
    if(seen)return {kind:'ambiguous'};
    seen=true;selected=ts.isPropertyAssignment(member)?member:undefined;unknown=!selected;
  }
  return selected?{kind:'explicit',node:selected}:{kind:unknown?'ambiguous':'missing'};
}
const property=(object:ts.ObjectLiteralExpression,name:string)=>{
  const found=authoredProperty(object,name);
  return found.kind==='explicit'?found.node.initializer:undefined;
};
/** Structural device instance: factory("ID",{x,y,...}). Factory identifier is intentionally irrelevant. */
export function asDeviceCall(node:ts.Node,_tree:ts.SourceFile):DeviceCall|undefined {
  if(!ts.isCallExpression(node))return;
  const [first,second]=node.arguments;
  if(!first||!ts.isStringLiteral(first)||!second||!ts.isObjectLiteralExpression(second))return;
  const x=property(second,'x'),y=property(second,'y');
  if(!x||!y)return;
  return {id:first.text,call:node,idLiteral:first,options:second,x,y};
}
export function deviceCalls(tree:ts.SourceFile,ids?:ReadonlySet<string>):DeviceCall[] {
  const result:DeviceCall[]=[];
  const visit=(node:ts.Node)=>{if(ts.isFunctionLike(node))return;const found=asDeviceCall(node,tree);if(found&&(!ids||ids.has(found.id)))result.push(found);ts.forEachChild(node,visit);};
  visit(tree);return result;
}
/** Mount coordinates may be authored directly or through mount(enclosure,{x,y}). */
export function mountCoordinates(call:DeviceCall,_tree:ts.SourceFile):{x:ts.Expression;y:ts.Expression}|undefined {
  const value=property(call.options,'mount');
  const object=value&&ts.isObjectLiteralExpression(value)?value:value&&ts.isCallExpression(value)&&value.arguments[1]&&ts.isObjectLiteralExpression(value.arguments[1])?value.arguments[1]:undefined;
  if(!object)return;
  const x=property(object,'x'),y=property(object,'y');
  return x&&y?{x,y}:undefined;
}
export const numericLiteral=(node:ts.Expression)=>
  ts.isNumericLiteral(node)||ts.isPrefixUnaryExpression(node)&&[ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(node.operator)&&ts.isNumericLiteral(node.operand);
