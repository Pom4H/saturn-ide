import { useEffect, useState } from 'react';
import type { GitReview, GitState } from '../core/git';
import type { Locale, Problem } from '../core';
import type { DocumentBuffer } from './model/documents';
import { api } from './api';
import { GitDiff } from './git-diff';
import { releaseLabel, releasePhaseLabel, releaseComparisonLabel } from './release-label';
import { IdentityValue } from './identity-value';
import { ResourceIcon } from './icons';
import './review-pane.css';

interface ReleaseIdentities { checked:string|null;published:string|null;applied:string|null;phase:string;error:string }
interface SemanticChange { semanticId:string;kind:string;type:'added'|'removed'|'renamed'|'changed';message:Record<Locale,string> }
interface ReviewPaneProps {
  compactIdentities?:boolean;
  locale:Locale;connected:boolean;git:GitState|null;releases:ReleaseIdentities|null;releaseError:string;
  semanticChanges:readonly SemanticChange[];semanticReady:boolean;semanticError:string;
  problems:readonly Problem[];sourcePath?:string;documents:ReadonlyMap<string,DocumentBuffer>;
  selectedFile:string;selectFile:(path:string)=>void;close:()=>void;
}
function fileDiff(diff:string,path:string){
  return diff.split(/(?=^diff --git )/m).find(section=>{
    const header=section.split('\n',1)[0]??'';
    return header.endsWith(` b/${path}`)||header.endsWith(` "b/${path}"`);
  })??'';
}
const brief=(identity:string|null|undefined)=>identity?identity.replace(/^sha256:/,'').slice(0,12):'—';
export function ReviewPane({compactIdentities=false,locale,connected,git,releases,releaseError,semanticChanges,semanticReady,semanticError,problems,sourcePath,documents,selectedFile,selectFile,close}:ReviewPaneProps){
  const ru=locale==='ru';
  const [review,setReview]=useState<GitReview|null>(null),[reviewError,setReviewError]=useState('');
  useEffect(()=>{
    if(!connected||!git?.available)return;
    const abort=new AbortController();setReview(null);setReviewError('');
    void api<GitReview>('git/review',undefined,abort.signal).then(setReview,error=>{if(!abort.signal.aborted)setReviewError(error instanceof Error?error.message:String(error));});
    return()=>abort.abort();
  },[connected,git]);
  const source=sourcePath?documents.get(sourcePath):undefined;
  const file=review?.files.includes(selectedFile)?selectedFile:sourcePath&&review?.files.includes(sourcePath)?sourcePath:review?.files[0]??'';
  const diff=file&&review?fileDiff(review.diff,file):'';
  const state=!connected?'offline':reviewError||releaseError||semanticError?'failed':releases?.phase==='faulted'?'faulted':!git||git.available&&(!review||!releases||!semanticReady)?'loading':git.available?'ready':'no-git';
  return <aside className="inspector resource-details review-pane" aria-label={ru?'Ревью проекта':'Project review'} data-review-state={state}>
    <div className="pane-heading"><strong>{ru?'Ревью':'Review'}</strong><button className="icon-button" aria-label={ru?'Закрыть ревью':'Close review'} onClick={close}><ResourceIcon icon="close" size={15}/></button></div>
    <div className="inspector-body review-body">
      {!connected&&<p className="review-message" role="status">{ru?'Нет связи. Показаны последние доступные данные; состояние Git и выпусков сейчас не обновляется.':'Offline. Showing the last available data; Git and release state are not refreshing.'}</p>}
      {sourcePath&&<section className="review-section"><h3>{ru?'Текущий исходник':'Current source'}</h3><code className="review-path">{sourcePath}</code><p className="review-file-state">{source?.error?source.error:source?.saving?(ru?'Сохраняется…':'Saving…'):source&&source.draft!==source.source?(ru?'Черновик не сохранён':'Unsaved draft'):(ru?'Буфер сохранён':'Buffer saved')}</p></section>}
      <section className="review-section">{compactIdentities&&<p className="review-quiet">{!connected?(ru?'Сведения о сборках могут быть устаревшими.':'Build information may be stale.'):releaseError?(ru?'Состояние сборок недоступно.':'Build status unavailable.'):releases?releaseComparisonLabel(releases,locale):(ru?'Загрузка состояния сборок…':'Loading build status…')}</p>}<details className="review-identity-details" key={compactIdentities?'compact':'full'} open={compactIdentities?undefined:true}><summary>{ru?'Идентичности сборок':'Build identities'}</summary><dl className="review-identities">
        <div><dt>Git HEAD</dt><dd title={git?.head??''}>{git?.available?`${git.branch} · ${brief(git.head)}`:'—'}</dd></div>
        <div><dt>{releaseLabel('checked',locale)}</dt><dd className="review-identity-value">{releases?<IdentityValue value={releases.checked} locale={locale}/>: '…'}</dd></div>
        <div><dt>{releaseLabel('published',locale)}</dt><dd className="review-identity-value">{releases?<IdentityValue value={releases.published} locale={locale}/>: '…'}</dd></div>
        <div><dt>{releaseLabel('applied',locale)}</dt><dd className="review-identity-value">{releases?<IdentityValue value={releases.applied} locale={locale}/>: '…'}</dd></div>

      </dl></details><dl className="review-phase"><div className={releases?.phase==='faulted'?'review-faulted':''} data-release-phase={releases?.phase}><dt>{ru?'Фаза исполнения':'Runtime phase'}</dt><dd>{releasePhaseLabel(releases?.phase,locale)}</dd></div></dl>{releases?.error&&<p className="review-message review-release-error" role="alert">{releases.error}</p>}{releaseError&&<p className="review-message" role="alert">{ru?'Идентичности выпуска недоступны: ':'Release identities unavailable: '}{releaseError}</p>}</section>
      <section className="review-section"><h3>{ru?'Проверка проекта':'Project check'} <small>{problems.length}</small></h3>
        {problems.length?problems.slice(0,8).map((problem,index)=><p className="review-problem" key={`${problem.code}:${problem.path??''}:${index}`}><strong>{problem.code}</strong><span>{problem.message[locale]}</span>{problem.path&&<code>{problem.path}</code>}</p>):<p className="review-quiet">{ru?'Текущая модель не сообщает проблем.':'The current model reports no issues.'}</p>}
        {problems.length>8&&<p className="review-quiet">+{problems.length-8}</p>}
      </section>
      <section className="review-section"><h3>{ru?'Применено → Проверено · модель':'Applied → Checked · model'} <small>{semanticReady&&releases?.checked&&releases.applied?semanticChanges.length:'—'}</small></h3>
        {semanticError?<p className="review-message" role="alert">{ru?'Сравнение модели недоступно: ':'Model comparison unavailable: '}{semanticError}</p>:!semanticReady?<p className="review-quiet" role="status">{connected?(ru?'Сравнение модели…':'Comparing model…'):(ru?'Нет связи':'Offline')}</p>:!releases?.checked?<p className="review-quiet">{ru?'Проверенной сборки пока нет.':'No checked build is available.'}</p>:!releases.applied?<p className="review-quiet">{ru?'Нет применённой сборки; сравнение недоступно.':'No applied build; comparison is unavailable.'}</p>:semanticChanges.length?semanticChanges.slice(0,8).map(change=><p className="review-semantic" key={change.semanticId}><strong>{change.kind}</strong><span>{change.message[locale]}</span></p>):<p className="review-quiet">{ru?'Семантических изменений относительно применённой сборки нет.':'No semantic changes relative to applied.'}</p>}
        {semanticReady&&releases?.checked&&releases.applied&&!semanticError&&semanticChanges.length>8&&<p className="review-quiet">+{semanticChanges.length-8}</p>}
      </section>
      <section className="review-section"><h3>{ru?'Рабочая копия · изменённые файлы':'Working tree · changed files'} <small>{review?.files.length??'—'}</small></h3>
        {!git?<p className="review-quiet" role="status">{ru?'Загрузка Git…':'Loading Git…'}</p>:!git.available?<p className="review-message" role="status">{ru?'Git-репозиторий проекта не создан.':'The project has no Git repository.'}</p>:reviewError?<p className="review-message" role="alert">{ru?'Не удалось прочитать изменения: ':'Could not read changes: '}{reviewError}</p>:!review?<p className="review-quiet" role="status">{ru?'Чтение изменений…':'Reading changes…'}</p>:review.files.length?<div className="review-files" role="list">{review.files.map(path=><div key={path} role="listitem"><button aria-current={file===path?'true':undefined} onClick={()=>selectFile(path)}><ResourceIcon icon="file" size={14}/><span>{path}</span></button></div>)}</div>:<p className="review-quiet">{ru?'Изменений относительно Git HEAD нет.':'No changes relative to Git HEAD.'}</p>}
        {review?.limited&&<p className="review-message" role="status">{ru?'Объём предпросмотра ограничен; список файлов может быть полнее diff.':'Preview size is limited; the file list may be more complete than the diff.'}</p>}
      </section>
      {!!file&&review&&<section className="review-section review-diff-section"><h3>{ru?'Изменения файла':'File changes'}</h3><code className="review-path">{file}</code>{diff?<GitDiff diff={diff} label={`${ru?'Изменения':'Changes'} ${file}`}/>:<p className="review-quiet">{ru?'Текстовый diff для файла недоступен.':'No text diff is available for this file.'}</p>}</section>}
    </div>
  </aside>;
}
