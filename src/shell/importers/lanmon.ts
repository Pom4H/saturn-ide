import type { MigrationFile, MigrationInventory } from '../../core/assistant';
type Kind = MigrationFile['kind'];
const formats: ReadonlyMap<string, Kind> = new Map([
  ...['ini', 'cfg', 'xml', 'json', 'csv', 'dat'].map(ext => [ext, 'configuration'] as const),
  ...['lm2', 'map', 'lm4'].map(ext => [ext, 'screen'] as const),
  ...['pas', 'bas', 'vb', 'cpp', 'js', 'vbs'].map(ext => [ext, 'script'] as const),
  ...['fr3', 'frf'].map(ext => [ext, 'report'] as const),
  ...['bmp', 'png', 'jpg', 'ico', 'wav', 'avi'].map(ext => [ext, 'asset'] as const),
]);
const migrationWarnings: Partial<Record<Kind, string>> = {
  script: 'Скрипты требуют переноса логики и сценарных тестов. Они не исполнялись.',
  screen: 'Геометрия и привязки карт требуют отдельного преобразования; наличие файла не означает перенос экрана.',
  report: 'Отчёты требуют сопоставления полей, расписаний и правил пропусков данных.',
};

/** Structural inventory only: never execute legacy scripts or infer a protocol/address/unit. */
export function inspectLanmon(name:string,sha256:string,files:readonly {path:string;bytes:number;text?:string}[]):MigrationInventory {
  if(files.length>1000)throw new Error('Не более 1000 файлов');
  const warnings=new Set<string>();
  const result:MigrationFile[]=files.map(file=>{
    const lower=file.path.toLowerCase(),ext=lower.split('.').at(-1);
    const kind = formats.get(ext ?? '') ?? 'unsupported';
    const warning = migrationWarnings[kind];
    if (warning) warnings.add(warning);
    // Only section names and map references leave the browser. Values/passwords/scripts stay local.
    const sections=[...(file.text??'').matchAll(/^\[([\w .-]{1,80})\]\s*$/gm)].map(m=>m[1]!);
    const references=[...(file.text??'').matchAll(/^MAP\d+\s*=\s*([\w .\\/-]+\.(?:lm2|map|lm4))\s*$/gim)].map(m=>m[1]!);
    return {path:file.path,bytes:file.bytes,kind,sections:[...new Set(sections)].slice(0,80),references:references.slice(0,100)};
  });
  if(!result.some(f=>/lanmon\.ini$/i.test(f.path)))warnings.add('LANMON.INI не найден: версия и корневая конфигурация не подтверждены.');
  warnings.add('Версия Lanmon не определяется по расширению. Проверьте версию проекта; адреса, единицы, права и команды требуют подтверждения инженера.');
  return {name,sha256,files:result,warnings:[...warnings]};
}
