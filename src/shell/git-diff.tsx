import {useMemo,type ReactNode} from 'react';
import {typescriptLanguage} from '@codemirror/lang-javascript';
import {highlightTree,tagHighlighter,tags} from '@lezer/highlight';
const highlighter=tagHighlighter([
 {tag:tags.keyword,class:'diff-keyword'},{tag:[tags.string,tags.regexp],class:'diff-string'},
 {tag:[tags.number,tags.bool,tags.null],class:'diff-number'},{tag:tags.comment,class:'diff-comment'},
 {tag:[tags.propertyName,tags.typeName],class:'diff-property'},
]);
function code(text:string){const parts:ReactNode[]=[];let end=0;highlightTree(typescriptLanguage.parser.parse(text),highlighter,(from,to,style)=>{if(from>end)parts.push(text.slice(end,from));parts.push(<span key={from} className={style}>{text.slice(from,to)}</span>);end=to;});parts.push(text.slice(end));return parts;}
export function GitDiff({diff,label}:{diff:string;label:string}){
 const lines=useMemo(()=>{let old=0,next=0;return diff.split('\n').map((text,index)=>{
  const header=text.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);let left:number|undefined,right:number|undefined;
  const kind=header?'hunk':/^(diff |index |--- |\+\+\+ |new file|deleted file|rename |similarity |Binary )/.test(text)?'meta':text.startsWith('+')?'added':text.startsWith('-')?'removed':'context';
  if(header){old=Number(header[1]);next=Number(header[2]);}else if(kind==='added')right=next++;else if(kind==='removed')left=old++;else if(text.startsWith(' ')){left=old++;right=next++;}
  return <div className={'git-diff-line '+kind} key={index}><span className="diff-line-number" aria-hidden="true">{left}</span><span className="diff-line-number" aria-hidden="true">{right}</span><code>{kind==='meta'||kind==='hunk'?text:<>{text.slice(0,1)}{code(text.slice(1))}</>}</code></div>;
 });},[diff]);
 return <div className="git-diff" role="region" aria-label={label} tabIndex={0}>{lines}</div>;
}
