import ts from 'typescript';

export interface DeviceCall {
  readonly id:string;
  readonly call:ts.CallExpression;
  readonly idLiteral:ts.StringLiteral;
  readonly options:ts.ObjectLiteralExpression;
  readonly x:ts.Expression;
  readonly y:ts.Expression;
}
const property=(object:ts.ObjectLiteralExpression,name:string,tree:ts.SourceFile)=>
  object.properties.filter(ts.isPropertyAssignment).find(p=>p.name.getText(tree).replace(/^['"]|['"]$/g,'')===name)?.initializer;
/** Structural device instance: factory("ID",{x,y,...}). Factory identifier is intentionally irrelevant. */
export function asDeviceCall(node:ts.Node,tree:ts.SourceFile):DeviceCall|undefined {
  if(!ts.isCallExpression(node))return;
  const [first,second]=node.arguments;
  if(!first||!ts.isStringLiteral(first)||!second||!ts.isObjectLiteralExpression(second))return;
  const x=property(second,'x',tree),y=property(second,'y',tree);
  if(!x||!y)return;
  return {id:first.text,call:node,idLiteral:first,options:second,x,y};
}
export function deviceCalls(tree:ts.SourceFile,ids?:ReadonlySet<string>):DeviceCall[] {
  const result:DeviceCall[]=[];
  const visit=(node:ts.Node)=>{const found=asDeviceCall(node,tree);if(found&&(!ids||ids.has(found.id)))result.push(found);ts.forEachChild(node,visit);};
  visit(tree);return result;
}
/** Mount coordinates may be authored directly or through mount(enclosure,{x,y}). */
export function mountCoordinates(call:DeviceCall,tree:ts.SourceFile):{x:ts.Expression;y:ts.Expression}|undefined {
  const value=property(call.options,'mount',tree);
  const object=value&&ts.isObjectLiteralExpression(value)?value:value&&ts.isCallExpression(value)&&value.arguments[1]&&ts.isObjectLiteralExpression(value.arguments[1])?value.arguments[1]:undefined;
  if(!object)return;
  const x=property(object,'x',tree),y=property(object,'y',tree);
  return x&&y?{x,y}:undefined;
}
export const numericLiteral=(node:ts.Expression)=>
  ts.isNumericLiteral(node)||ts.isPrefixUnaryExpression(node)&&[ts.SyntaxKind.MinusToken,ts.SyntaxKind.PlusToken].includes(node.operator)&&ts.isNumericLiteral(node.operand);
