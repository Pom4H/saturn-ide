import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Locale } from '../core';
import { decisionPresets } from '../core/decision';
import type { CommandShell } from './model/commands/engine';
import './decision-panel.css';

/** Text is an input to the same Shell, not a second chat or a remote browser session. */
export function DecisionPanel({ commands, locale }: { commands: CommandShell; locale: Locale }) {
  const decisions = commands.decisions, ru = locale === 'ru';
  const state = useSyncExternalStore(decisions.subscribe, decisions.getSnapshot, decisions.getSnapshot);
  const [value, setValue] = useState('');
  const [preset, setPreset] = useState<keyof typeof decisionPresets>('kev');
  useEffect(() => { void decisions.loadStatus(); }, [decisions]);
  useEffect(() => {
    if (!['thinking', 'clarify', 'ready'].includes(state.phase)) return;
    const timer = setInterval(() => decisions.reconcile(), 1000);
    return () => clearInterval(timer);
  }, [decisions, state.phase]);
  useEffect(() => setValue(''), [state.argument?.name, state.phase]);
  const running = state.phase === 'running', thinking = state.phase === 'thinking';
  const plan = state.plan, configured = state.status?.enabled === true;
  const setup = `SATURN_DECISION_PROVIDER=${preset}\n${preset === 'kev' ? '# SATURN_DECISION_MODEL=kev-latest\n# SATURN_DECISION_TIMEOUT_MS=60000' : 'SATURN_DECISION_API_KEY=your-key'}`;
  const choices = (start: number, end?: number) => state.options.slice(start, end).map(item => <button type="button" key={item.id} onClick={() => void decisions.choose(item.id)}>
    <strong>{item.label || (ru ? 'Без аргумента' : 'Omit')}</strong><small>{item.detail}</small>
  </button>);
  return <section className="decision-panel" aria-label={ru ? 'Управление IDE текстом' : 'Text control'} aria-busy={thinking || running}>
    <div className="decision-connection"><span>{state.status?.model || (ru ? 'Модель не настроена' : 'Model not configured')}</span><details><summary>{ru ? 'Подключение' : 'Connection'}</summary>
      {configured ? <><code>{state.status?.endpoint}</code><p>{ru ? 'Это адрес со стороны сервера Saturn, не браузера. Ключ хранится на сервере. Автоматического переключения на другой API нет.' : 'This address is reached by the Saturn host, not the browser. The key stays on the host. There is no automatic API fallback.'}</p></> : <>
        <p>{state.status?.error}</p><label>{ru ? 'Пример настроек' : 'Configuration example'} <select value={preset} onChange={event => setPreset(event.target.value as keyof typeof decisionPresets)}><option value="kev">Kev · local</option><option value="typesafe">Jev · TypeSafe</option><option value="vercel">Jev · Vercel AI Gateway</option></select></label>
        <pre>{setup}</pre><p>{ru ? 'Добавьте в .env каталога Saturn IDE и перезапустите bun dev. Для своего сервера задайте SATURN_DECISION_URL и SATURN_DECISION_MODEL.' : 'Add to .env in the Saturn IDE directory and restart bun dev. For your own server, set SATURN_DECISION_URL and SATURN_DECISION_MODEL.'}</p>
      </>}
      <p>{ru ? 'Модели передаются запрос, ограниченная сводка проекта, имена и пути ресурсов, типы и показания. Полные исходники и session key не передаются.' : 'The model receives your request, a bounded project summary, resource names and paths, types and readings. Full source files and the session key are not sent.'}</p>
      <button type="button" onClick={() => void decisions.loadStatus()}>{ru ? 'Проверить настройки' : 'Refresh configuration'}</button>
    </details></div>
    <form className="decision-input" onSubmit={event => { event.preventDefault(); void decisions.prepare(); }}>
      <textarea aria-label={ru ? 'Запрос к IDE' : 'IDE request'} rows={2} maxLength={2000} disabled={running} value={state.input}
        placeholder={ru ? 'Покажи выбранный насос в коде' : 'Show the selected pump in source'} onChange={event => decisions.setInput(event.target.value)}
        onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void decisions.prepare(); } if (event.key === 'Escape') { event.preventDefault(); decisions.cancel(); } }}/>
      <div className="decision-buttons"><button type="submit" disabled={!configured || !state.input.trim() || running || thinking}>{ru ? 'Подготовить' : 'Prepare'}</button>
        {(thinking || running || state.phase === 'ready' || state.phase === 'clarify') && <button type="button" onClick={() => decisions.cancel()}>{running ? ru ? 'Остановить ожидание' : 'Stop waiting' : ru ? 'Отмена' : 'Cancel'}</button>}
        <small>{ru ? 'Enter — запрос · Shift Enter — новая строка' : 'Enter — request · Shift Enter — newline'}</small>
      </div>
    </form>
    {thinking && <p role="status">{ru ? 'Подбираю ' : 'Selecting '}{state.argument ? state.argument.name : ru ? 'действие' : 'an action'}…</p>}
    {state.phase === 'clarify' && <div className="decision-clarification">
      <p role="status">{state.argument ? `${ru ? 'Уточните' : 'Specify'}: ${state.argument.name}` : ru ? 'Выберите действие. Модель не смогла однозначно определить запрос.' : 'Choose an action. The model could not resolve the request.'}</p>
      {state.argument && <form onSubmit={event => { event.preventDefault(); void decisions.provide(value); }}><input aria-label={ru ? 'Точный ID или значение' : 'Exact ID or value'} value={value} onChange={event => setValue(event.target.value)} placeholder={ru ? 'Точный ID, путь или значение' : 'Exact ID, path or value'}/><button type="submit" disabled={!value.trim()}>{ru ? 'Продолжить' : 'Continue'}</button></form>}
      <div className="decision-options">{choices(0, 5)}</div>
      {state.options.length > 5 && <details><summary>{ru ? 'Остальные варианты' : 'More options'} ({state.options.length - 5})</summary><div className="decision-options">{choices(5)}</div></details>}
      <small>{ru ? 'Ничего не выполнено. При отсутствии нужного объекта введите точный ID или измените запрос.' : 'Nothing has run. Enter an exact ID or revise the request when the target is absent.'}</small>
    </div>}
    {plan && state.phase === 'ready' && <div className="decision-proposal" data-effect={plan.effect}>
      <p><strong>{plan.description}</strong></p><pre aria-label={ru ? 'Предлагаемая команда' : 'Proposed command'}>{plan.command}</pre>
      <div className="decision-scope"><span>{plan.project}</span><strong data-live={plan.mode === 'live'}>{plan.mode}</strong><code title={plan.applied}>{plan.applied ? plan.applied.slice(0, 12) : ru ? 'Нет applied' : 'No applied build'}</code><span>{plan.effect}</span></div>
      {plan.effect === 'control' && <p>{ru ? 'Команда уйдёт в указанную среду. Принятие команды не подтверждает физический результат.' : 'The command will be sent to this environment. Acceptance does not confirm a physical result.'}</p>}
      {plan.effect === 'save' && <p>{ru ? 'Будет сохранён текущий черновик. Автопредпросмотр симуляции зависит от настроек host; это не разрешение на live apply.' : 'The current draft will be saved. Simulator auto-preview follows host settings; this does not authorize live apply.'}</p>}
      <button type="button" className="primary" onClick={() => void decisions.confirm(plan.id)}>{ru ? 'Подтвердить выполнение' : 'Confirm execution'}</button>
      <small>{ru ? 'Предложение действует 60 секунд и отменяется при изменении контекста.' : 'Valid for 60 seconds; context changes invalidate the proposal.'}</small>
    </div>}
    {(running || state.phase === 'error' || state.phase === 'done') && <div className="decision-result" role={state.phase === 'error' ? 'alert' : 'status'}><pre>{state.message.slice(0, 12000)}</pre></div>}
    {state.phase === 'idle' && <small>{ru ? 'Модель только выбирает существующие действия. Создание кода и произвольные изменения схемы здесь не выполняются.' : 'The model selects existing actions only. Code generation and arbitrary diagram changes are not performed here.'}</small>}
  </section>;
}
