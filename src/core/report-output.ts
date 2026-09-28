import {text,type Locale,type Value} from '../core';
import type {QueryReport,ReportColumn,ReportSchema,ExcelWorkbookSpec} from './reporting';
import type {ReportResult} from '../reports';
export interface QueryReportResult {kind:'query';id:string;label:QueryReport['label'];from:number;to:number;generatedAt:number;revision:string;columns:QueryReport['columns'];schema:ReportSchema;rows:Record<string,Value|null>[];definition:QueryReport;inputs:Record<string,number>}
export type ReportOutput=(ReportResult|QueryReportResult)&{artifactId?:string;snapshotHash?:string;actor?:string;trigger?:string;runId?:string};
export interface ReportTable {columns:readonly ReportColumn[];schema:ReportSchema;rows:Record<string,Value|null>[];excel?:ExcelWorkbookSpec}
export function reportTable(result:ReportOutput):ReportTable{
  if('kind' in result&&result.kind==='query')return {columns:result.columns,schema:result.schema,rows:result.rows,excel:result.definition.excel};
  const r=result as ReportResult,columns:ReportColumn[]=[{key:'$from',title:'UTC from'},{key:'$to',title:'UTC to'}],schema:Record<string,ReportSchema[string]>={'$from':{key:'$from',type:'datetime',unit:''},'$to':{key:'$to',type:'datetime',unit:''}};
  for(const [key,c] of Object.entries(r.columns)){columns.push({key:'value.'+key,title:c.label,unit:c.unit??c.signal.unit},{key:'coverage.'+key,title:key+' coverage',unit:'%'});schema['value.'+key]={key:'value.'+key,type:typeof c.signal.initial as 'number'|'boolean'|'string',unit:c.unit??c.signal.unit??''};schema['coverage.'+key]={key:'coverage.'+key,type:'number',unit:'%'};}
  return {columns,schema,rows:r.rows.map(row=>Object.fromEntries([['$from',new Date(row.from).toISOString()],['$to',new Date(row.to).toISOString()],...Object.keys(r.columns).flatMap(key=>[['value.'+key,row.values[key]??null],['coverage.'+key,(row.coverage[key]??0)*100]])]))};
}
export function outputCsv(result:ReportOutput,locale:Locale):string{
  const table=reportTable(result),cell=(value:unknown)=>{let s=String(value??'');if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
  return '\uFEFF'+[table.columns.map(c=>text(c.title,locale)+(c.unit?` (${c.unit})`:'')),...table.rows.map(r=>table.columns.map(c=>r[c.key]))].map(row=>row.map(cell).join(',')).join('\r\n');
}
export const escapeHtml=(value:unknown)=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export function reportChartSvg(result:QueryReportResult,locale:Locale):string{
  const chart=result.definition.chart;
  if(!chart)return '';
  const values=result.rows.map(row=>row[chart.y]);
  const numbers=values.filter((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  if(!numbers.length)return `<p>${locale==='ru'?'Нет достоверных данных для графика':'No reliable chart data'}</p>`;
  const coordinates=result.rows.map((row,index)=>{
    const value=row[chart.x];
    const number=typeof value==='number'?value:result.schema[chart.x]?.type==='datetime'&&typeof value==='string'?Date.parse(value):index;
    return Number.isFinite(number)?number:index;
  });
  const xMin=Math.min(...coordinates),xMax=Math.max(...coordinates);
  const observedMin=Math.min(...numbers),observedMax=Math.max(...numbers);
  const pad=Math.max((observedMax-observedMin)*.15,Math.abs((observedMin+observedMax)/2)*.02,.05);
  const low=chart.type==='bar'?Math.min(0,observedMin):observedMin-pad;
  const high=chart.type==='bar'?Math.max(0,observedMax,low+1):observedMax+pad;
  const x=(index:number)=>55+(coordinates[index]!-xMin)*680/Math.max(1,xMax-xMin);
  const y=(value:number)=>180-(value-low)/(high-low)*155;
  let path='',marks='',continuous=false;
  values.forEach((value,index)=>{
    if(typeof value!=='number'||!Number.isFinite(value)){continuous=false;return;}
    if(chart.type==='bar'){
      const baseline=y(0),width=Math.min(32,600/values.length);
      marks+=`<rect x="${x(index)-width/2}" y="${Math.min(y(value),baseline)}" width="${width}" height="${Math.abs(y(value)-baseline)}" fill="#087f8c"/>`;
    }else{
      path+=`${continuous?'L':'M'}${x(index)} ${y(value)} `;
      marks+=`<circle cx="${x(index)}" cy="${y(value)}" r="6" fill="#087f8c"/>`;
      continuous=true;
    }
  });
  const axisLabel=(value:Value|null|undefined)=>{
    if(result.schema[chart.x]?.type==='datetime'&&typeof value==='string'){
      const at=Date.parse(value);
      if(Number.isFinite(at))return new Date(at).toLocaleString(locale,{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';
    }
    return String(value??'—');
  };
  return `<figure><figcaption>${escapeHtml(text(chart.title,locale))}${chart.unit?' · '+escapeHtml(chart.unit):''}</figcaption><svg role="img" aria-label="${escapeHtml(text(chart.title,locale))}" viewBox="0 0 780 195"><path d="M55 20V180H750" fill="none" stroke="#aab5bb"/><text x="4" y="28" font-size="11">${high.toFixed(2)}</text><text x="4" y="180" font-size="11">${low.toFixed(2)}</text><path d="${path}" fill="none" stroke="#087f8c" stroke-width="2"/>${marks}</svg><small class="chart-window">${escapeHtml(axisLabel(result.rows[0]?.[chart.x]))} — ${escapeHtml(axisLabel(result.rows.at(-1)?.[chart.x]))}<br>${locale==='ru'?'Точек графика':'Chart values'}: ${numbers.length} / ${values.length}</small></figure>`;
}
export function reportHtml(result:ReportOutput,locale:Locale):string{
  const table=reportTable(result),e=escapeHtml,ru=locale==='ru';let summary='',chart='',description='',parameters='';
  if('kind' in result&&result.kind==='query'){
    parameters=Object.keys(result.inputs).length?'<p>'+e(JSON.stringify(result.inputs))+'</p>':'';
    description=result.definition.description?`<p>${e(text(result.definition.description,locale))}</p>`:'';chart=reportChartSvg(result,locale);
    summary=(result.definition.summary??[]).map(m=>{const v=result.rows.map(r=>r[m.key]).filter((v):v is number=>typeof v==='number'),sum=v.reduce((a,b)=>a+b,0),value=!v.length?null:m.aggregate==='sum'?sum:m.aggregate==='avg'?sum/v.length:m.aggregate==='min'?Math.min(...v):m.aggregate==='max'?Math.max(...v):v.at(-1)!;return `<div><small>${e(text(m.label,locale))}</small><strong>${value===null?'—':e(value.toLocaleString(locale,{maximumFractionDigits:m.digits??1}))}</strong>${e(m.unit)}</div>`;}).join('');
  }
  const noRows=table.rows.length?'':`<p role="status">${ru?'За выбранный период нет строк отчёта.':'No report rows for this period.'}</p>`;
  const coverageNote='kind' in result
    ? (ru?'Обработка пропусков задана SQL-определением отчёта. Результат зафиксирован; экспорт не читает live-данные.':'Missing-data handling follows the report SQL. This result is frozen; export does not read live data.')
    : (ru?'Пропуски и недостоверные интервалы не равны нулю. Результат зафиксирован; экспорт не читает live-данные.':'Missing and invalid intervals are not zero. This result is frozen; export does not read live data.');
  const cell=(key:string,value:Value|null)=>{
    if(value===null)return '—';
    if(table.schema[key]?.type==='datetime'&&typeof value==='string'){
      const at=Date.parse(value);
      if(Number.isFinite(at)){
        const date=new Date(at);
        const day=date.toLocaleDateString(locale,{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'UTC'});
        const time=date.toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'});
        return `<time datetime="${e(value)}"><span>${e(day)}</span><span>${e(time)} UTC</span></time>`;
      }
    }
    return e(value);
  };
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><title>${e(text(result.label,locale))}</title><style>*{box-sizing:border-box}body{margin:0;background:#eef1f2;color:#152129;font:14px system-ui}main{max-width:1000px;margin:24px auto;padding:48px;background:white}h1{font-size:32px}header,footer{border-bottom:1px solid #dde4e7;padding-bottom:20px}small,footer{color:#68757e}.metrics{display:flex;gap:32px;margin:28px 0}.metrics strong{display:block;font-size:28px}figure{margin:24px 0}figure .chart-window{display:block;margin-top:6px;font-size:11px;line-height:1.5;overflow-wrap:anywhere}svg{max-height:260px;width:100%}table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{text-align:left;border-bottom:1px solid #dde4e7;padding:10px;overflow-wrap:anywhere}td time span{display:block;white-space:nowrap}th{background:#edf5f6}footer{font-size:11px;margin-top:32px;overflow-wrap:anywhere}@media(max-width:600px){main{margin:0;padding:20px}.metrics{flex-wrap:wrap}.table{overflow:auto}}@page{size:A4 landscape;margin:12mm}@media print{body{background:white}main{margin:0;padding:0}thead{display:table-header-group}tr,figure{break-inside:avoid}}</style></head><body><main><header><small>SATURN · ${ru?'ИНЖЕНЕРНЫЙ ОТЧЁТ':'ENGINEERING REPORT'}</small><h1>${e(text(result.label,locale))}</h1>${description}<p>${new Date(result.from).toISOString()} — ${new Date(result.to).toISOString()} · UTC</p></header><section class="metrics">${summary}</section>${chart}${noRows}<div class="table"><table><thead><tr>${table.columns.map(c=>`<th>${e(text(c.title,locale))}${c.unit?`<small> · ${e(c.unit)}</small>`:''}</th>`).join('')}</tr></thead><tbody>${table.rows.map(r=>'<tr>'+table.columns.map(c=>`<td>${cell(c.key,r[c.key]??null)}</td>`).join('')+'</tr>').join('')}</tbody></table></div><footer><p>${coverageNote}</p>${parameters}<p>Build ${e(result.revision)} · Snapshot ${e(result.snapshotHash??'—')}<br>Run ${e(result.runId??result.artifactId??'—')} · ${e(result.trigger??'—')} · ${e(result.actor??'—')} · ${new Date(result.generatedAt).toISOString()}</p></footer></main></body></html>`;
}
