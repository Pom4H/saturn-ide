export interface Word { value:string; from:number; to:number; closed:boolean }
/** Shell quoting only. No evaluation, interpolation, pipes or subprocess expansion. */
export function words(line:string):Word[] {
  const result:Word[]=[];
  let i=0;
  while(i<line.length){
    if(/\s/.test(line[i]!)){i++;continue;}
    const from=i;let value='',quote='';
    while(i<line.length){
      const char=line[i]!;
      if(!quote&&/\s/.test(char))break;
      if(char==='\\'&&quote!=="'"){i++;if(i<line.length)value+=line[i++]!;continue;}
      if(char==='"'||char==="'"){if(!quote){quote=char;i++;continue;}if(quote===char){quote='';i++;continue;}}
      value+=char;i++;
    }
    result.push({value,from,to:i,closed:!quote});
  }
  return result;
}
export const quoteWord = (value:string) => /^[\w./:@-]+$/.test(value)?value:JSON.stringify(value);
