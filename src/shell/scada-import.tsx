import { useRef, useState } from 'react';
import type { Locale, Problem } from '../core';
import { text } from '../core';
import type { ScadaImporter, ScadaImportPlan } from '../core/importer';
import { api } from './api';
import { readImportSource } from './import-source';

interface Preview { plan: ScadaImportPlan; projectVersion: string; importer: ScadaImporter }

export function ScadaImport({importers,locale,onImported}:{importers:readonly ScadaImporter[];locale:Locale;onImported:()=>Promise<void>}) {
  const ru=locale==='ru',file=useRef<HTMLInputElement>(null),[preview,setPreview]=useState<Preview>(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
  const accepts=[...new Set(importers.flatMap(importer=>importer.accepts))].join(',');
  const prepare=async(selected:File)=>{
    setBusy(true);setError('');setDone('');
    try{
      const [{projectVersion},source]=await Promise.all([api<{projectVersion:string}>('import/context'),readImportSource(selected)]);
      const ranked=importers.map(importer=>({importer,score:importer.detect(source)})).filter(item=>Number.isFinite(item.score)&&item.score>0).sort((a,b)=>b.score-a.score);
      const importer=ranked[0]?.importer;if(!importer)throw new Error(ru?'Ни один установленный плагин импорта не распознал проект':'No installed importer recognized this project');
      const plan=await importer.import(source);
      if(plan.importer!==importer.id||plan.sourceFingerprint!==source.fingerprint)throw new Error('Importer returned an inconsistent plan');
      setPreview({plan,projectVersion,importer});
    }catch(reason){setPreview(undefined);setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const apply=async()=>{
    if(!preview)return;setBusy(true);setError('');
    try{
      const result=await api<{problems:readonly Problem[]}>('import/apply',{plan:preview.plan,projectVersion:preview.projectVersion});
      await onImported();
      if(result.problems.length)setError((ru?'Исходники созданы, но проект требует исправлений: ':'Source was created, but the project has build issues: ')+result.problems.map(item=>item.message[locale]).join('; '));
      else{setDone(ru?'Миграция записана в исходники проекта. Проверьте изменения в Git; публикация выполняется отдельно.':'Migration was written to project source. Review the Git diff; publishing is a separate action.');setPreview(undefined);}
    }catch(reason){setError(reason instanceof Error?reason.message:String(reason));}
    finally{setBusy(false);}
  };
  const blockers=preview?.plan.diagnostics.filter(item=>item.severity==='blocker').length??0;
  return <section className="scada-import">
    <div className="scada-import-heading"><div><strong>{ru?'Миграция SCADA':'SCADA migration'}</strong><small>{importers.length?importers.map(item=>text(item.label,locale)).join(' · '):(ru?'Нет подключённых importer-плагинов':'No importer plugins connected')}</small></div><input ref={file} type="file" accept={accepts||'.zip'} hidden onChange={event=>{const selected=event.target.files?.[0];if(selected)void prepare(selected);event.target.value='';}}/><button type="button" disabled={busy||!importers.length} onClick={()=>file.current?.click()}>{busy?'…':ru?'Открыть проект':'Open project'}</button></div>
    {preview&&<details className="import-inventory" open><summary>{text(preview.importer.label,locale)+' · '+preview.plan.files.length+' '+(ru?'файлов Saturn':'Saturn files')+' · '+(blockers?blockers+' blockers':(ru?'готово к применению':'ready to apply'))}</summary>
      {preview.plan.summary&&<p>{text(preview.plan.summary,locale)}</p>}
      {!!preview.plan.stats&&<div className="import-stats">{Object.entries(preview.plan.stats).map(([key,count])=><span key={key}>{key}: {count}</span>)}</div>}
      <div className="import-file-list">{preview.plan.diagnostics.slice(0,80).map((item,index)=><div key={index} data-severity={item.severity}><code>{item.code}</code><small>{item.message[locale]}{item.path?' · '+item.path:''}</small></div>)}</div>
      {preview.plan.diagnostics.length>80&&<small>{ru?'Показаны первые 80 замечаний':'Showing first 80 diagnostics'}</small>}
      <p>{ru?'Импорт записывает исходники проекта. Симулятор в dev-режиме может обновить предпросмотр автоматически; для реального объекта публикация и применение — отдельные действия.':'Import writes project source. The dev simulator may refresh its preview automatically; publishing and applying to a real asset are separate actions.'}</p>
      <button type="button" className="primary" disabled={busy||blockers>0} onClick={()=>void apply()}>{ru?'Внести в исходники':'Write project source'}</button> <button type="button" disabled={busy} onClick={()=>setPreview(undefined)}>{ru?'Отмена':'Cancel'}</button>
    </details>}
    {error&&<p className="import-error" role="alert">{error}</p>}{done&&<p className="import-hint" role="status">{done}</p>}
  </section>;
}
