import type { MigrationFile, MigrationInventory } from './assistant';
/** Structural inventory only: never execute legacy scripts or infer a protocol/address/unit. */
export function inspectLanmon(name:string,sha256:string,files:readonly {path:string;bytes:number;text?:string}[]):MigrationInventory {
  if(files.length>1000)throw new Error('Не более 1000 файлов');
  const warnings=new Set<string>();
  const result:MigrationFile[]=files.map(file=>{
    const lower=file.path.toLowerCase(),ext=lower.split('.').at(-1);
    const kind:MigrationFile['kind']=['ini','cfg','xml','json','csv','dat'].includes(ext??'')?'configuration':['lm2','map','lm4'].includes(ext??'')?'screen':['pas','bas','vb','cpp','js','vbs'].includes(ext??'')?'script':['fr3','frf'].includes(ext??'')?'report':['bmp','png','jpg','ico','wav','avi'].includes(ext??'')?'asset':'unsupported';
    if(kind==='script')warnings.add('Скрипты требуют переноса логики и сценарных тестов. Они не исполнялись.');
    if(kind==='screen')warnings.add('Геометрия и привязки карт требуют отдельного преобразования; наличие файла не означает перенос экрана.');
    if(kind==='report')warnings.add('Отчёты требуют сопоставления полей, расписаний и правил пропусков данных.');
    // Only section names and map references leave the browser. Values/passwords/scripts stay local.
    const sections=[...(file.text??'').matchAll(/^\[([\w .-]{1,80})\]\s*$/gm)].map(m=>m[1]!);
    const references=[...(file.text??'').matchAll(/^MAP\d+\s*=\s*([\w .\\/-]+\.(?:lm2|map|lm4))\s*$/gim)].map(m=>m[1]!);
    return {path:file.path,bytes:file.bytes,kind,sections:[...new Set(sections)].slice(0,80),references:references.slice(0,100)};
  });
  if(!result.some(f=>/lanmon\.ini$/i.test(f.path)))warnings.add('LANMON.INI не найден: версия и корневая конфигурация не подтверждены.');
  warnings.add('Версия Lanmon не определяется по расширению. Проверьте версию проекта; адреса, единицы, права и команды требуют подтверждения инженера.');
  return {name,sha256,files:result,warnings:[...warnings]};
}
