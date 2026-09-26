import {reportHtml,outputCsv,type ReportOutput} from '../core/report-output';
import {reportXlsx} from '../runtime/report-xlsx';
import type {Project,Locale} from '../core';
import type {Store} from '../runtime/store';
import {runReport,loadReport,ReportError} from '../runtime/report';
export function reportDownload(report:ReportOutput,format:string,locale:Locale):Response{
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':`attachment; filename="${report.id.replace(/[^A-Za-z0-9_-]/g,'_')}.${format}"`};
  if(format==='xlsx')return new Response(reportXlsx(report,locale),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}});
  if(format==='html')return new Response(reportHtml(report,locale),{headers:{...headers,'Content-Type':'text/html;charset=utf-8'}});
  if(format==='csv')return new Response(outputCsv(report,locale),{headers:{...headers,'Content-Type':'text/csv;charset=utf-8'}});
  if(format!=='json')throw new ReportError(400,'Unknown report format');return Response.json(report,{headers:{'Cache-Control':'no-store'}});
}
export async function reportResponse(store:Store,project:Project,revision:string,url:URL):Promise<Response>{
  let inputs:unknown;try{inputs=JSON.parse(url.searchParams.get('inputs')??'{}');}catch{throw new ReportError(400,'Invalid report inputs JSON');}
  const artifact=url.searchParams.get('artifact');
  const report=artifact?await loadReport(store,artifact):await runReport(store,project,revision,url.searchParams.get('id')??'',Number(url.searchParams.get('from')),Number(url.searchParams.get('to')),{inputs});
  return reportDownload(report,url.searchParams.get('format')??'json',url.searchParams.get('locale')==='en'?'en':'ru');
}
