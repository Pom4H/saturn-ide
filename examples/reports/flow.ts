import {report,reportSchema,reportField,dateTimeField,reportColumn,excelColumn,excelSheet,workbook,asc,desc,type Signal} from '@saturn/core';
/** Copy this source into a project and call with its own typed flow signal. */
export function flowReport(flow:Signal<number>){
  const rows=reportSchema({time:dateTimeField(),flow:reportField(flow)});
  return report('flow-detail',{
    label:{ru:'Расход · типизированный отчёт',en:'Flow · typed report'},
    description:{ru:'Архивные измерения. Пропуски качества сохраняются в таблице и на графике.',en:'Archived observations. Invalid quality remains missing in the table and chart.'},
    signals:[flow],schema:rows,window:3600000,
    inputs:{scale:{type:'number',default:1,min:.1,max:10,label:{ru:'Масштаб',en:'Scale'}}},
    sql:"SELECT start AS time, CASE WHEN quality='good' THEN value*:scale ELSE NULL END AS flow FROM segments ORDER BY start",
    columns:[reportColumn('Время UTC',rows.time),reportColumn('Расход',rows.flow)],
    summary:[{key:'flow',label:'Максимум',aggregate:'max',unit:flow.unit,digits:2,emphasis:'primary'}],
    chart:{x:'time',y:'flow',title:'Расход и пропуски',type:'line',unit:flow.unit},
    excel:workbook([
      excelSheet('Измерения',rows,{columns:[excelColumn('Время UTC',rows.time,{width:26,format:'yyyy-mm-dd hh:mm:ss'}),excelColumn('Расход',rows.flow,{width:24,format:'0.000'})],sort:[asc(rows.time)],freezeRows:1,autoFilter:true}),
      excelSheet('Максимумы',rows,{columns:[excelColumn('Расход',rows.flow,{format:'0.000'}),excelColumn('Время UTC',rows.time)],sort:[desc(rows.flow)],freezeRows:1,autoFilter:true}),
    ]),
  });
}
