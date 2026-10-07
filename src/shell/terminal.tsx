/** @jsxImportSource @opentui/react */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import type { TextareaRenderable } from '@opentui/core';
import { availableEditors, editorNames, findResources, terminalIcon, type ShellLocale, type EditorId } from '../core/resources';
import { isAttached, endLabel, text } from '../core';
import type { IDEState } from '../protocol';
import type { ReportResult } from '../reports';
import { ShellSession } from './model/session';
import { ShellClient } from './client';
import { useShell } from './use-shell';
import { CommandShell } from './model/commands/engine';
import { CommandTerminal } from './command-terminal';
import { displaySample } from './model/observations';

export function TerminalApp({ client, quit, consoleOnly = false }: { client: ShellClient; quit: () => void; consoleOnly?:boolean }) {
  const shell = useShell(client, 'terminal');
  useKeyboard(key => { if (!shell.state && key.ctrl && (key.name === 'c' || key.name === 'q')) { key.preventDefault(); quit(); } });
  if (!shell.state) return <text>{shell.error || 'Saturn: connecting to the local workspace…'}</text>;
  return <TerminalView commands={shell.commands} consoleOnly={consoleOnly} client={client} session={shell.session} state={shell.state} connected={shell.connected} connectionError={shell.error} quit={quit}/>;
}
/** Terminal projections are text, not browser DOM or substituted SVG screenshots. */
export function TerminalView({ client, session, state, connected, connectionError, quit, commands, consoleOnly=false }: {
  commands?:CommandShell; consoleOnly?:boolean; client: ShellClient; session: ShellSession; state: IDEState; connected: boolean; connectionError?: string; quit: () => void;
}) {
  const current=useRef({state,connected});current.current={state,connected};
  const [fallback]=useState(()=>new CommandShell({session,state:()=>current.current.state,connected:()=>current.current.connected,request:(path,body,signal)=>client.request(path,body,signal)}));
  const commandShell=commands??fallback;
  const [consoleOpen,setConsoleOpen]=useState(consoleOnly);
  useEffect(()=>()=>fallback.dispose(),[fallback]);
  const nav = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const buffers = useSyncExternalStore(session.documents.subscribe, session.documents.getSnapshot, session.documents.getSnapshot);
  const { width, height } = useTerminalDimensions();
  const [locale, setLocale] = useState<ShellLocale>('ru'), [focus, setFocus] = useState<'tree' | 'search' | 'source'>('tree');
  const [query, setQuery] = useState(''), [message, setMessage] = useState(''), [quitArmed, setQuitArmed] = useState(false);
  const [output, setOutput] = useState(''), [now, setNow] = useState(Date.now());
  const textarea = useRef<TextareaRenderable | null>(null);
  const catalog = session.getCatalog(), resource = catalog.resources.find(r => r.uri === nav.active?.uri), buffer = buffers.get(nav.source);
  const items = findResources(catalog, query, locale);
  const editors = resource ? availableEditors(resource, 'terminal') : [];
  const perform = async (editor: EditorId) => {
    if (!resource) return;
    try { await session.execute({ type: 'open', uri: resource.uri, editor }); setMessage(''); if (editor === 'source') setFocus('source'); }
    catch (e) { setMessage(String(e)); }
  };
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    let cancelled = false; setOutput('');
    if (nav.surface === 'reports') {
      const id = resource?.kind === 'report' ? resource.entityId : state.project.reports?.[0]?.id;
      if (id) {
        const to = Date.now(), from = to - 3600_000;
        void client.request<ReportResult>(`report?id=${encodeURIComponent(id)}&from=${from}&to=${to}`).then(result => {
          const keys = Object.keys(result.columns);
          const rows = result.rows.map(r => `${new Date(r.from).toISOString().slice(11, 16)}  ${keys.map(k => `${r.values[k] ?? '—'} (${Math.round((r.coverage[k] ?? 0) * 100)}%)`).join(' | ')}`);
          if (!cancelled) setOutput(`${text(result.label, locale)}\n${keys.join(' | ')}\n${rows.join('\n')}`);
        }).catch(e => { if (!cancelled) setOutput(String(e)); });
      }
    } else if (nav.surface === 'git') void client.request<{ branch: string; status: string; diff: string }>('git').then(g => {
      if (!cancelled) setOutput(`${g.branch}\n${g.status}\n${g.diff}`);
    }).catch(e => { if (!cancelled) setOutput(String(e)); });
    return () => { cancelled = true; };
  }, [nav.surface, nav.active?.uri, client, locale, state.project]);
  useKeyboard(key => {
    if (key.ctrl && (key.name === 'q' || !consoleOpen && key.name === 'c')) {
      key.preventDefault();
      if (session.documents.dirty && !quitArmed) { setQuitArmed(true); setMessage(locale === 'ru' ? 'Есть черновики. Ctrl+Q ещё раз — выйти без сохранения.' : 'Unsaved drafts. Ctrl+Q again discards them.'); }
      else quit(); return;
    }
    setQuitArmed(false);
    if(key.name==='f7'){key.preventDefault();setConsoleOpen(value=>!value);return;}
    if(consoleOpen)return;
    if (key.ctrl && key.name === 's') { key.preventDefault(); void session.execute({ type: 'save' }).then(() => setMessage('Saved')).catch(e => setMessage(String(e))); }
    if (key.ctrl && key.name === 'k') { key.preventDefault(); setFocus('search'); }
    if (key.name === 'tab') { key.preventDefault(); setFocus(f => f === 'tree' ? 'source' : 'tree'); }
    if (key.name === 'escape') { key.preventDefault(); setFocus('tree'); }
    if (key.name === 'f2') void perform('source');
    if (key.name === 'f3') void perform('diagram');
    if (key.name === 'f4') void perform('signals');
    if (key.name === 'f5') void perform('reports');
    if (key.name === 'f6') session.setSurface('git');
    if (key.name === 'f8') setLocale(l => l === 'ru' ? 'en' : 'ru');
  });
  const equipment = state.project.equipment.find(e => e.id === nav.selected);
  const edges = [...state.project.pipes, ...state.project.cables ?? []].filter(e => !equipment || [e.from, e.to].filter(isAttached).map(end => end.device).includes(equipment.id));
  const signalLines = Object.values(state.project.signals).map(signal => {
    const sample = displaySample(signal,state.snapshot.samples[signal.id],connected,now,state.snapshot.simulation);
    const good = sample?.quality === 'good';
    return `${signal.id.padEnd(22)} ${good ? String(sample.value) : '—'} ${signal.unit ?? ''} [${good ? 'good' : 'stale'}]`;
  });
  const detail = nav.surface === 'signals' ? signalLines.join('\n')
    : nav.surface === 'reports' || nav.surface === 'git' ? output || 'Loading…'
    : nav.surface === 'targets' ? `Local ${state.mode}\nApplied ${state.revision || '—'}\nStorage ${state.adapter}`
    : `${resource?.name[locale] ?? ''}\n${resource?.source?.path ?? ''}\n\n${edges.map(e => `${e.kind}: ${endLabel(e.from)} -> ${endLabel(e.to)}`).join('\n')}\n\n${signalLines.join('\n')}`;
  if(consoleOpen)return <box width="100%" height="100%" flexDirection="column"><text> Saturn · {text(state.project.label,locale)} · {connected?'SSE':'OFFLINE'} {message}</text><CommandTerminal commands={commandShell}/></box>;
  return <box width="100%" height="100%" flexDirection="column">
    <box height={3} border paddingLeft={1}><text><strong>Saturn</strong>  {text(state.project.label, locale)}  [{state.mode}]  {connected ? 'SSE' : 'OFFLINE'}</text></box>
    <box flexGrow={1} flexDirection="row">
      <box width={Math.max(22, Math.min(42, Math.floor(width * .34)))} border flexDirection="column" title={locale === 'ru' ? 'Проект' : 'Project'}>
        <input focused={focus === 'search'} value={query} placeholder="Ctrl+K · name / class / file" onInput={setQuery} onSubmit={() => setFocus('tree')}/>
        <select key={query} focused={focus === 'tree'} height={Math.max(4, height - 9)} options={items.map(r => ({ name: `[${terminalIcon(r.icon)}] ${r.name[locale]}`, description: r.entityId ?? r.source?.path ?? '' }))} onSelect={index => {
          const selected = items[index]; if (selected) void session.execute({ type: 'open', uri: selected.uri }).catch(e => setMessage(String(e)));
        }} showDescription showScrollIndicator/>
      </box>
      <box flexGrow={1} border flexDirection="column" title={resource?.name[locale] ?? 'Saturn'}>
        <text>{editors.map(e => `${nav.surface === e ? '>' : ''}${editorNames[e][locale]}`).join('  ')}</text>
        {nav.surface === 'source' && buffer ? <textarea key={`${buffer.path}:${buffer.version}`} ref={textarea} initialValue={buffer.draft} focused={focus === 'source'} flexGrow={1}
          onContentChange={() => { if (textarea.current) session.documents.edit(buffer.path, textarea.current.plainText); }}
        /> : <scrollbox flexGrow={1}><text>{detail}</text></scrollbox>}
      </box>
    </box>
    <text>{message || buffer?.error || connectionError || `${buffers.size} documents · ${session.documents.dirty ? 'Modified' : 'Saved'} · ${state.revision.slice(0, 12)}`}</text>
    <text>F2 Source  F3 Topology  F4 Signals  F5 Report  F6 Git  F7 Console  F8 RU/EN  Ctrl+S Save  Ctrl+Q Exit</text>
  </box>;
}
