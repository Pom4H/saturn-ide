/** URL projection only. An MCP HTML resource can have an immutable about:srcdoc URL. */
interface EmbeddedNavigation {current:URL;entries:URL[];index:number}
let embedded:EmbeddedNavigation|undefined;
export const viewLocation={
  get pathname(){return embedded?embedded.current.pathname:location.pathname;},
  get search(){return embedded?embedded.current.search:location.search;},
  get hash(){return embedded?embedded.current.hash:location.hash;},
  get href(){return embedded?embedded.current.href:location.href;},
};
export function configureEmbeddedView(search:string){
  const current=new URL('/'+search,'http://saturn.local');embedded={current,entries:[current],index:0};
}
export function restoreEmbeddedView(search:string){
  if(!embedded)return;embedded.current=new URL('/'+search,embedded.current);embedded.entries[embedded.index]=embedded.current;
  dispatchEvent(new PopStateEvent('popstate'));
}
export function embeddedHistory(){return embedded?{back:embedded.index>0,forward:embedded.index<embedded.entries.length-1}:undefined;}
export function writeEmbeddedView(url:string,push:boolean){
  if(!embedded)return false;
  embedded.current=new URL(url,embedded.current);
  if(push){embedded.entries.splice(++embedded.index);embedded.entries.push(embedded.current);}else embedded.entries[embedded.index]=embedded.current;
  return true;
}
export function goEmbeddedView(delta:number){
  if(!embedded)return false;
  const index=embedded.index+delta;if(index>=0&&index<embedded.entries.length){embedded.index=index;embedded.current=embedded.entries[index]!;dispatchEvent(new PopStateEvent('popstate'));}
  return true;
}
