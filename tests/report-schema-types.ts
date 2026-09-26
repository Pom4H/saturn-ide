import {signal,reportField,reportSchema,numberField,booleanField,textField,dateTimeField,excelColumn,excelSheet,asc,reportColumn,report,type ReportRow} from '../src/core';
const schema=reportSchema({flow:reportField(signal('flow',{initial:1})),time:dateTimeField(),flag:booleanField(),name:textField(),n:numberField('bar')});
excelColumn('Date',schema.time,{format:'yyyy-mm-dd'});
excelColumn('Flow',schema.flow,{format:'0.00'});
// @ts-expect-error boolean does not accept numeric formatting
excelColumn('Flag',schema.flag,{format:'0.00'});
// @ts-expect-error string does not accept numeric formatting
excelColumn('Name',schema.name,{format:'0.00'});
// @ts-expect-error unknown field cannot be used to sort this sheet
excelSheet('Sheet',schema,{columns:[excelColumn('Flow',schema.flow)],sort:[asc(reportSchema({other:numberField()}).other)]});
const r=report('typed',{label:'Typed',sql:'SELECT 1 AS flow',schema,signals:[],window:1000,columns:[reportColumn('Flow',schema.flow)]});
const row:ReportRow<typeof r>={flow:1,time:'2026-01-01T00:00:00.000Z',flag:false,name:null,n:2};
// @ts-expect-error output value inferred from signal
row.flow='wrong';
// @ts-expect-error unknown output column
report('bad',{label:'Bad',sql:'SELECT 1',schema,signals:[],window:1000,columns:[{key:'unknown',title:'Unknown'}]});
