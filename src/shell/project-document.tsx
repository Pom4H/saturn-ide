import type { ReactNode } from 'react';

function inline(source:string):ReactNode[] {
  return source.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part,index)=>
    part.startsWith('**')&&part.endsWith('**')?<strong key={index}>{part.slice(2,-2)}</strong>:
    part.startsWith('`')&&part.endsWith('`')?<code key={index}>{part.slice(1,-1)}</code>:part);
}

function cells(line:string):string[] {
  return line.trim().replaceAll('\\|','\uE000').replace(/^\||\|$/g,'').split('|').map(cell=>cell.trim().replaceAll('\uE000','|'));
}

const heading=(line:string)=>/^#{1,3} /.test(line);
const table=(line:string)=>line.startsWith('|');
const list=(line:string)=>line.startsWith('- ');

/** Renders the generated documentation as text nodes; project content is never interpreted as HTML. */
export function ProjectDocument({markdown}:{markdown:string}) {
  const lines=markdown.split('\n'),blocks:ReactNode[]=[];
  for(let i=0;i<lines.length;){
    const line=lines[i]!.trim();
    if(!line){i++;continue;}
    if(heading(line)){
      const depth=line.match(/^#+/)![0].length,content=inline(line.slice(depth+1));
      blocks.push(depth===1?<h2 key={i}>{content}</h2>:depth===2?<h3 key={i}>{content}</h3>:<h4 key={i}>{content}</h4>);
      i++;continue;
    }
    if(line.startsWith('> ')){blocks.push(<blockquote key={i}>{inline(line.slice(2))}</blockquote>);i++;continue;}
    if(table(line)){
      const start=i,headers=cells(line);i++;
      if(i<lines.length&&/^\|?[\s:|\-]+\|?$/.test(lines[i]!.trim()))i++;
      const rows:string[][]=[];
      while(i<lines.length&&table(lines[i]!.trim()))rows.push(cells(lines[i++]!));
      blocks.push(<div className="project-document-table" key={start}><table><thead><tr>{headers.map((cell,index)=><th key={index} scope="col">{inline(cell)}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{headers.map((_,column)=><td key={column}>{inline(row[column]??'')}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if(list(line)){
      const start=i,items:string[]=[];
      while(i<lines.length&&list(lines[i]!.trim()))items.push(lines[i++]!.trim().slice(2));
      blocks.push(<ul key={start}>{items.map((item,index)=><li key={index}>{inline(item)}</li>)}</ul>);
      continue;
    }
    const start=i,paragraph:string[]=[];
    while(i<lines.length&&lines[i]!.trim()&&!heading(lines[i]!.trim())&&!table(lines[i]!.trim())&&!list(lines[i]!.trim())&&!lines[i]!.trim().startsWith('> '))paragraph.push(lines[i++]!.trim());
    blocks.push(<p key={start}>{paragraph.map((part,index)=><span key={index}>{index>0&&<br/>}{inline(part.replace(/  $/,''))}</span>)}</p>);
  }
  return <article className="project-document">{blocks}</article>;
}
