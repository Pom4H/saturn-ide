/** One command catalog for browser, TTY and machine clients. These are workspace paths, not OS commands. */
export const commandAreas = ['project', 'runtime', 'source', 'reports', 'git'] as const;
export type CommandArea = typeof commandAreas[number];
export type ArgumentKind = 'resource'|'endpoint'|'device'|'signal'|'writable'|'value'|'alarm'|'file'|'offset'|'code'|'editor'|'report'|'hours'|'text'|'area';
export interface CommandArgument { name:string; kind:ArgumentKind; optional?:boolean; rest?:boolean }
export interface CommandSpec { path:string; description:string; icon:string; effect:'read'|'navigate'|'draft'|'save'|'control'; args:readonly CommandArgument[] }
const arg = (name:string,kind:ArgumentKind,optional=false,rest=false):CommandArgument => ({name,kind,optional,rest});
export const commandCatalog = [
  {path:'help',description:'Справка и полный контракт команд',icon:'docs',effect:'read',args:[]},
  {path:'cd',description:'Перейти в раздел оболочки',icon:'project',effect:'navigate',args:[arg('раздел','area')]},
  {path:'pwd',description:'Текущий раздел',icon:'project',effect:'read',args:[]},
  {path:'clear',description:'Очистить журнал терминала',icon:'terminal',effect:'navigate',args:[]},
  {path:'project list',description:'Ресурсы и реальные пути исходников',icon:'project',effect:'read',args:[arg('поиск','text',true,true)]},
  {path:'project context',description:'Сводка выбранного устройства, топологии и свежих данных',icon:'inspector',effect:'read',args:[]},
  {path:'project inspect',description:'Объект, AST-диапазон и связанные ресурсы',icon:'inspector',effect:'read',args:[arg('объект','resource')]},
  {path:'project open',description:'Открыть объект в общей ShellSession',icon:'source',effect:'navigate',args:[arg('объект','resource'),arg('вид','editor',true)]},
  {path:'project topology',description:'Физические соединения выбранного устройства',icon:'diagram',effect:'read',args:[arg('устройство','device',true)]},
  {path:'project trace',description:'Проследить соединения от конкретного порта',icon:'ports',effect:'read',args:[arg('устройство.порт','endpoint')]},
  {path:'project ports',description:'Порты устройства из его определения',icon:'ports',effect:'read',args:[arg('устройство','device')]},
  {path:'runtime status',description:'Связь, режим, checked / published / applied',icon:'targets',effect:'read',args:[]},
  {path:'runtime signals',description:'Показания, единицы и качество данных',icon:'signals',effect:'read',args:[arg('устройство','device',true)]},
  {path:'runtime get',description:'Прочитать показание сигнала',icon:'signals',effect:'read',args:[arg('сигнал','signal')]},
  {path:'runtime set',description:'Отправить типизированную команду runtime',icon:'signals',effect:'control',args:[arg('сигнал','writable'),arg('значение','value')]},
  {path:'runtime alarms',description:'Текущее состояние тревог',icon:'bell',effect:'read',args:[]},
  {path:'runtime ack',description:'Квитировать тревогу через runtime',icon:'bell',effect:'control',args:[arg('тревога','alarm')]},
  {path:'runtime runs',description:'Запуски применённых сборок и provenance измерений',icon:'signals',effect:'read',args:[]},
  {path:'runtime compare',description:'Сравнить сигнал в двух запусках: A/B, разница и покрытие',icon:'signals',effect:'read',args:[arg('сигнал','signal'),arg('run-A','text'),arg('run-B','text'),arg('минуты','text',true)]},
  {path:'runtime history',description:'История наблюдений сигнала',icon:'signals',effect:'read',args:[arg('сигнал','signal')]},
  {path:'source read',description:'Прочитать общий черновик TypeScript',icon:'source',effect:'read',args:[arg('файл','file')]},
  {path:'source insert',description:'Вставить код в черновик; Tab — TypeScript completion',icon:'source',effect:'draft',args:[arg('файл','file'),arg('позиция','offset'),arg('код','code',false,true)]},
  {path:'source save',description:'Сохранить черновик с проверкой версии файла',icon:'file',effect:'save',args:[arg('файл','file')]},
  {path:'source diagnostics',description:'Проверить черновик через TypeScript Language Service',icon:'warning',effect:'read',args:[arg('файл','file')]},
  {path:'source complete',description:'Получить реальные TypeScript completions',icon:'source',effect:'read',args:[arg('файл','file'),arg('позиция','offset')]},
  {path:'reports run',description:'Отчёт по архиву с покрытием данных',icon:'reports',effect:'read',args:[arg('отчёт','report'),arg('часы','hours',true)]},
  {path:'git status',description:'Состояние Git рабочего проекта',icon:'git',effect:'read',args:[]},
  {path:'git diff',description:'Изменения рабочих файлов',icon:'git',effect:'read',args:[]},
] as const satisfies readonly CommandSpec[];
export type CommandPath = typeof commandCatalog[number]['path'];
export const commandAliases:Readonly<Record<string,CommandPath>> = {set:'runtime set',signals:'runtime signals'};
export const usage = (spec:CommandSpec) => `/${spec.path}${spec.args.map(a=>` ${a.optional?'[':'<'}${a.name}${a.rest?'…':''}${a.optional?']':'>'}`).join('')}`;
