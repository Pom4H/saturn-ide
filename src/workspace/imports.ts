import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/** Compiler and language service resolve the same declared public API, independent of host placement. */
export function projectImports(appRoot:string):Record<string,string[]> {
  const exports:unknown=JSON.parse(readFileSync(join(appRoot,'package.json'),'utf8')).exports;
  const paths:Record<string,string[]>={'@saturn/scada/acquisition':[join(appRoot,'src/runtime/acquisition.ts')]};
  if(exports&&typeof exports==='object')for(const [key,value] of Object.entries(exports))if(typeof value==='string'&&value.startsWith('./')){
    const suffix=key==='.'?'':key.slice(1);
    paths['@saturn/core'+suffix]=[join(appRoot,value)];paths['saturn-ide'+suffix]=[join(appRoot,value)];
  }
  return paths;
}
