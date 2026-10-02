import {useEffect,useRef} from 'react';
/** Same generated, escaped report document in a scoped DOM; Apps hosts need no nested iframe. */
export function ReportDocument({html}:{html:string}){
  const root=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!root.current)return;const shadow=root.current.shadowRoot??root.current.attachShadow({mode:'open'});
    const document=new DOMParser().parseFromString(html,'text/html');
    shadow.replaceChildren(...[...document.head.querySelectorAll('style')].map(style=>style.cloneNode(true)),...document.body.childNodes);
  },[html]);
  return <div ref={root} className="report-document" data-report-document="inline"/>;
}
