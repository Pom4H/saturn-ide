const byId = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const state = { key: '', separator: '/', connected: false, pending: null, remoteOperation: null, activeTab: 'create', recent: [], poll: null, pollVersion: 0, completedCloneId: null, failedCloneId: null, cancelRequested: false, navigating: false };
let cloneNameEdited = false;

class LauncherError extends Error {
  constructor(message, code, directory) {
    super(message);
    this.code = code;
    this.directory = directory;
  }
}

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.classList.add('icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

function announce(message) { byId('announcement').textContent = message; }
function setNotice(message) {
  byId('launcher-notice').textContent = message || '';
  byId('launcher-notice').hidden = !message;
}
function setError(message) {
  byId('action-error').textContent = message || '';
  byId('action-error').hidden = !message;
  if (message) byId('action-error').focus();
}

function currentOperation() { return state.pending || state.remoteOperation; }
function updateControls() {
  const operation = currentOperation();
  const locked = !state.connected || Boolean(operation);
  for (const fieldset of document.querySelectorAll('fieldset')) fieldset.disabled = locked;
  for (const tab of tabs) tab.disabled = locked;
  for (const button of document.querySelectorAll('.recent-open, .recent-remove, .results-empty-action')) {
    button.disabled = locked || button.dataset.unavailable === 'true';
  }
  for (const button of document.querySelectorAll('[data-project-submit]')) {
    button.disabled = locked || !button.form.querySelector('input[name="projectDirectory"]:checked');
  }
  for (const panel of document.querySelectorAll('.start-panel')) panel.setAttribute('aria-busy', String(Boolean(operation)));
  byId('operation-status').hidden = state.connected && !operation;
  byId('operation-message').textContent = state.cancelRequested ? 'Отменяем клонирование…' : operation?.message || 'Подключаемся к Saturn IDE…';
  byId('cancel-clone').hidden = operation?.kind !== 'cloning';
  byId('cancel-clone').disabled = state.cancelRequested;
  byId('clone-settings-summary').setAttribute('aria-disabled', String(locked));
  byId('clone-settings-summary').tabIndex = locked ? -1 : 0;
}

function selectTab(name, focus = false) {
  if (currentOperation()) return;
  state.activeTab = name;
  setError('');
  for (const tab of tabs) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    byId(`panel-${tab.dataset.tab}`).hidden = !selected;
  }
  if (focus) byId(`tab-${name}`).focus();
}

for (const tab of tabs) {
  tab.addEventListener('click', () => selectTab(tab.dataset.tab));
  tab.addEventListener('keydown', (event) => {
    let index = tabs.indexOf(tab);
    if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') index = 0;
    else if (event.key === 'End') index = tabs.length - 1;
    else return;
    event.preventDefault();
    selectTab(tabs[index].dataset.tab, true);
  });
}

async function request(path, payload) {
  let response;
  try {
    response = await fetch(`/api/launcher${path}`, {
      method: payload === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      ...(payload === undefined ? {} : { headers: { 'Content-Type': 'application/json', 'X-Saturn-Key': state.key }, body: JSON.stringify(payload) }),
    });
  } catch {
    throw new LauncherError('Не удалось связаться с Saturn IDE. Проверьте, что приложение запущено, и повторите действие.', 'CONNECTION');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new LauncherError(body?.error || `Saturn IDE вернул ошибку ${response.status}. Повторите действие.`, body?.code, body?.directory);
  if (!body || typeof body !== 'object') throw new LauncherError('Saturn IDE вернул неожиданный ответ. Обновите страницу и попробуйте снова.', 'RESPONSE');
  return body;
}

function applyLauncherState(data, initial = false) {
  if (typeof data.key === 'string') state.key = data.key;
  if (data.separator === '\\' || data.separator === '/') state.separator = data.separator;
  state.recent = data.recent || [];
  state.remoteOperation = data.operation ? { kind: data.operation.phase, message: data.operation.message || (data.operation.phase === 'cloning' ? 'Клонируем репозиторий…' : 'Открываем проект…') } : null;
  if (initial) {
    for (const id of ['create-parent', 'clone-parent', 'open-directory']) {
      if (!byId(id).value) byId(id).value = data.defaultDirectory || '';
    }
    if (data.initialPath) {
      byId('open-directory').value = data.initialPath;
      const remoteOperation = state.remoteOperation;
      state.remoteOperation = null;
      selectTab('open');
      state.remoteOperation = remoteOperation;
    }
    if (state.remoteOperation?.kind === 'cloning') {
      const remoteOperation = state.remoteOperation;
      state.remoteOperation = null;
      selectTab('clone');
      state.remoteOperation = remoteOperation;
    }
    if (data.notice) setNotice(data.notice);
    if (state.remoteOperation && data.completedClone?.id) state.completedCloneId = data.completedClone.id;
  }
  if (!currentOperation() && data.completedClone?.id && data.completedClone.id !== state.completedCloneId) {
    const result = data.completedClone;
    const split = Math.max(result.directory.lastIndexOf('/'), result.directory.lastIndexOf('\\'));
    if (split >= 0) {
      const parent = result.directory.slice(0, split) || state.separator;
      byId('clone-parent').value = /^[a-z]:$/i.test(parent) ? parent + state.separator : parent;
      byId('clone-name').value = result.directory.slice(split + 1);
    }
    selectTab('clone');
    setNotice('');
    renderProjects('clone', result);
  }
  if (!currentOperation() && data.failedClone?.id && data.failedClone.id !== state.failedCloneId) {
    state.failedCloneId = data.failedClone.id;
    selectTab('clone');
    setNotice('');
    if (/CANCEL/i.test(data.failedClone.code || '')) setNotice(data.failedClone.error);
    else setError(data.failedClone.error);
  }
  renderRecent();
  updateDestinations();
  updateControls();
}

function schedulePoll() {
  const version = ++state.pollVersion;
  clearTimeout(state.poll);
  if (!currentOperation() || state.navigating) return;
  state.poll = setTimeout(async () => {
    try {
      const hadRemoteOperation = Boolean(state.remoteOperation);
      const previousClone = state.completedCloneId;
      const previousFailure = state.failedCloneId;
      const data = await request('');
      if (version !== state.pollVersion) return;
      applyLauncherState(data);
      if (hadRemoteOperation && !currentOperation()) {
        if (previousClone === state.completedCloneId && previousFailure === state.failedCloneId) setNotice(state.cancelRequested ? 'Клонирование отменено. Можно изменить адрес или папку и попробовать снова.' : 'Операция завершена. Выберите проект, чтобы продолжить.');
        state.cancelRequested = false;
        updateControls();
      }
    } catch (error) {
      if (version !== state.pollVersion) return;
      if (!state.pending) {
        state.remoteOperation = null;
        setError(error.message);
        updateControls();
      }
    }
    schedulePoll();
  }, 1200);
}

async function connect() {
  byId('connection-error').hidden = true;
  byId('retry-connection').disabled = true;
  try {
    const data = await request('');
    if (typeof data.key !== 'string' || !data.key) throw new LauncherError('Не удалось подготовить рабочую среду. Перезапустите Saturn IDE и подключитесь снова.');
    state.connected = true;
    applyLauncherState(data, true);
    schedulePoll();
  } catch (error) {
    state.connected = false;
    byId('connection-message').textContent = error.message;
    byId('connection-error').hidden = false;
    byId('operation-status').hidden = true;
    byId('recent-loading').textContent = 'Список появится после подключения.';
  } finally {
    byId('retry-connection').disabled = false;
  }
}
byId('retry-connection').addEventListener('click', connect);

async function runAction(kind, message, action, payload, onSuccess) {
  if (!state.connected || currentOperation()) return;
  setError('');
  setNotice('');
  const pending = { kind, message };
  state.pending = pending;
  state.cancelRequested = false;
  updateControls();
  schedulePoll();
  try {
    const result = await request(`/${action}`, payload);
    await onSuccess(result);
  } catch (error) {
    if (/CANCEL/i.test(error.code || '')) {
      setNotice('Клонирование отменено. Можно изменить адрес или папку и попробовать снова.');
    } else {
      setError(error.message);
      if (typeof error.directory === 'string') {
        const path = document.createElement('code');
        path.className = 'error-directory';
        path.textContent = error.directory;
        byId('action-error').append(path);
      }
      if (['GIT_INIT', 'CREATE_FAILED'].includes(error.code) && typeof error.directory === 'string') {
        const recovery = document.createElement('button');
        recovery.type = 'button';
        recovery.className = 'quiet-button results-empty-action';
        recovery.textContent = 'Открыть созданную папку';
        recovery.addEventListener('click', () => openProject(error.directory));
        byId('action-error').append(recovery);
      }
    }
  } finally {
    if (!state.navigating && state.pending === pending) {
      state.pending = null;
      state.remoteOperation = null;
      state.cancelRequested = false;
      state.pollVersion++;
      clearTimeout(state.poll);
      updateControls();
    }
  }
}

byId('cancel-clone').addEventListener('click', async () => {
  if (currentOperation()?.kind !== 'cloning' || state.cancelRequested) return;
  state.cancelRequested = true;
  updateControls();
  try {
    const result = await request('/cancel', {});
    if (result.cancelled === false) {
      state.cancelRequested = false;
      updateControls();
    }
  } catch (error) {
    if (currentOperation()?.kind === 'cloning') {
      state.cancelRequested = false;
      setError(error.message);
      updateControls();
    }
  }
});

function validateLeaf(input) {
  const name = input.value.trim();
  const error = !name ? 'Укажите название папки.' : /[/\\\u0000-\u001f]/.test(name) || name === '.' || name === '..' ? 'Укажите название одной папки, без / и \\.' : '';
  input.setCustomValidity(error);
  return !error;
}

function destination(parent, name) {
  const directory = parent.trim();
  const leaf = name.trim();
  if (!directory || !leaf) return '';
  const separator = /\\/.test(directory) ? '\\' : state.separator;
  return `${directory.replace(/[/\\]+$/, '')}${separator}${leaf}`;
}

function updateDestinations() {
  byId('create-destination').textContent = destination(byId('create-parent').value, byId('create-name').value) || 'Укажите название проекта и родительскую папку';
  byId('clone-destination').textContent = destination(byId('clone-parent').value, byId('clone-name').value) || 'Укажите адрес репозитория и папку';
}

function repositoryName(repository) {
  const source = repository.trim().replace(/[/\\]+$/, '');
  let path = source;
  try { path = new URL(source).pathname; } catch { /* SCP-style SSH and local paths do not need a URL scheme. */ }
  return path.split(/[/\\]/).filter(Boolean).at(-1)?.replace(/^.*:/, '').replace(/\.git$/i, '') || '';
}

function clearResults(kind) {
  byId(`${kind}-results`).hidden = true;
  byId(`${kind}-results`).replaceChildren();
  if (kind === 'clone') {
    byId('clone-submit').hidden = false;
    byId('clone-settings').open = true;
    byId('clone-settings-summary').hidden = true;
    byId('clone-destination-caption').textContent = 'Репозиторий будет сохранён здесь';
    byId('clone-description').textContent = 'Склонируем репозиторий на этот компьютер, затем выберем проект.';
  }
}

byId('clone-settings-summary').addEventListener('click', (event) => {
  if (currentOperation()) event.preventDefault();
});

for (const id of ['create-name', 'create-parent', 'clone-name', 'clone-parent']) {
  byId(id).addEventListener('input', () => {
    byId(id).setCustomValidity('');
    if (id === 'clone-name') cloneNameEdited = Boolean(byId(id).value);
    if (id.startsWith('clone')) clearResults('clone');
    updateDestinations();
  });
}
byId('open-directory').addEventListener('input', () => clearResults('open'));
byId('clone-repository').addEventListener('input', () => {
  byId('clone-repository').setCustomValidity('');
  if (!cloneNameEdited) byId('clone-name').value = repositoryName(byId('clone-repository').value);
  clearResults('clone');
  updateDestinations();
});

function openProject(directory) {
  return runAction('opening', 'Открываем проект… Это может занять несколько секунд.', 'open', { directory }, navigate);
}

function navigate(result) {
  if (typeof result.url !== 'string' || !result.url) throw new LauncherError('Проект подготовлен, но адрес IDE не получен. Попробуйте открыть его снова.');
  const url = new URL(result.url, location.href);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new LauncherError('Saturn IDE вернул неподдерживаемый адрес проекта.');
  location.assign(url.href);
  state.navigating = true;
}

byId('create-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!validateLeaf(byId('create-name')) || !event.currentTarget.reportValidity()) {
    event.currentTarget.reportValidity();
    return;
  }
  runAction('creating', 'Создаём и открываем проект…', 'create', { name: byId('create-name').value.trim(), parent: byId('create-parent').value.trim() }, navigate);
});

byId('discover-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const directory = byId('open-directory').value.trim();
  if (!directory) return;
  clearResults('open');
  runAction('discovering', 'Ищем проекты в выбранной папке…', 'discover', { directory }, (result) => renderProjects('open', result));
});

byId('clone-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = byId('clone-repository');
  try {
    const url = new URL(input.value.trim());
    if ((url.protocol === 'https:' || url.protocol === 'http:') && (url.username || url.password)) {
      input.setCustomValidity('Используйте адрес без логина и токена. Доступ к репозиторию должен быть настроен в Git.');
    }
  } catch { /* Git also accepts SSH syntax and local paths. */ }
  if (!validateLeaf(byId('clone-name')) || !event.currentTarget.reportValidity()) {
    event.currentTarget.reportValidity();
    return;
  }
  runAction('cloning', 'Клонируем репозиторий… Это может занять некоторое время.', 'clone', {
    repository: input.value.trim(), parent: byId('clone-parent').value.trim(), name: byId('clone-name').value.trim(),
  }, (result) => renderProjects('clone', result));
});

function renderProjects(kind, result) {
  const container = byId(`${kind}-results`);
  const projects = Array.isArray(result.projects) ? result.projects : [];
  container.replaceChildren();
  const heading = document.createElement('h3');
  heading.id = `${kind}-results-heading`;
  heading.tabIndex = -1;
  heading.textContent = kind === 'clone' ? 'Репозиторий сохранён' : projects.length ? 'Выберите проект' : 'Проекты не найдены';
  container.append(heading);
  if (kind === 'clone') {
    if (result.id) state.completedCloneId = result.id;
    const description = document.createElement('p');
    description.className = 'results-description';
    const path = document.createElement('code');
    path.textContent = result.directory;
    description.append(path);
    container.append(description);
    byId('clone-submit').hidden = true;
    byId('clone-settings').open = false;
    byId('clone-settings-summary').hidden = false;
    byId('clone-destination-caption').textContent = 'Репозиторий сохранён здесь';
    byId('clone-description').textContent = projects.length ? 'Локальная копия готова. Выберите проект для работы.' : 'Локальная копия готова. Теперь можно создать или выбрать проект.';
  }
  if (!projects.length) {
    const empty = document.createElement('p');
    empty.className = 'results-empty';
    empty.textContent = kind === 'clone'
      ? 'В репозитории не найден project.ts. Укажите папку существующего проекта или создайте новый внутри репозитория.'
      : 'В этой папке и на трёх уровнях внутри проект Saturn не найден. Укажите точный путь к папке с project.ts или создайте новый проект.';
    container.append(empty);
    if (kind === 'clone') {
      const actions = document.createElement('div');
      actions.className = 'empty-result-actions';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiet-button results-empty-action';
      button.textContent = 'Указать папку проекта';
      button.addEventListener('click', () => {
        byId('open-directory').value = result.directory;
        clearResults('open');
        selectTab('open');
        byId('open-directory').focus();
      });
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'quiet-button results-empty-action';
      create.textContent = 'Создать проект внутри';
      create.addEventListener('click', () => {
        byId('create-parent').value = result.directory;
        selectTab('create');
        updateDestinations();
        byId('create-name').focus();
      });
      actions.append(button, create);
      container.append(actions);
    }
  } else {
    const description = document.createElement('p');
    description.className = 'results-description';
    description.textContent = projects.length === 1 ? 'Проект найден и готов к открытию.' : `Найдено проектов: ${projects.length}. Выберите нужный.`;
    container.append(description);
    const form = document.createElement('form');
    const choices = document.createElement('fieldset');
    choices.className = 'project-choices';
    const legend = document.createElement('legend');
    legend.className = 'sr-only';
    legend.textContent = 'Проект для открытия';
    choices.append(legend);
    projects.forEach((project, index) => {
      const choice = document.createElement('label');
      choice.className = 'project-choice';
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'projectDirectory';
      input.value = project.directory;
      input.required = true;
      input.checked = projects.length === 1 && index === 0;
      const caption = document.createElement('span');
      const title = document.createElement('strong');
      title.textContent = project.label;
      const path = document.createElement('code');
      path.textContent = !project.relative || project.relative === '.' ? (kind === 'clone' ? 'Корень репозитория' : 'Корень выбранной папки') : project.relative;
      path.title = project.directory;
      caption.append(title, path);
      choice.append(input, caption);
      choices.append(choice);
      input.addEventListener('change', updateControls);
    });
    form.append(choices);
    if (result.limited) {
      const limited = document.createElement('p');
      limited.className = 'results-limited';
      limited.textContent = 'Показаны не все результаты. Если нужного проекта нет в списке, укажите более точную папку.';
      form.append(limited);
    }
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.dataset.projectSubmit = '';
    submit.className = 'primary-button';
    const caption = document.createElement('span');
    caption.textContent = 'Открыть проект';
    submit.append(caption, icon('arrow'));
    form.append(submit);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const selected = form.querySelector('input[name="projectDirectory"]:checked');
      if (selected) openProject(selected.value);
    });
    container.append(form);
  }
  container.hidden = false;
  heading.focus();
  announce(projects.length ? `Найдено проектов: ${projects.length}. Выберите проект для открытия.` : 'Проекты не найдены. Уточните путь к папке.');
}

function renderRecent() {
  const list = byId('recent-list');
  const focusedDirectory = document.activeElement?.dataset.directory;
  const focusedClass = document.activeElement?.className;
  list.replaceChildren();
  for (const project of state.recent) {
    const row = document.createElement('li');
    row.className = 'recent-row';
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'recent-open';
    open.dataset.directory = project.directory;
    open.dataset.unavailable = String(project.available === false);
    open.title = project.directory;
    const caption = document.createElement('span');
    caption.className = 'recent-text';
    const name = document.createElement('strong');
    name.textContent = project.label;
    const path = document.createElement('code');
    path.textContent = project.directory;
    caption.append(name, path);
    if (project.available === false) {
      const unavailable = document.createElement('small');
      unavailable.textContent = 'Папка недоступна';
      caption.append(unavailable);
    }
    open.append(icon('folder'), caption);
    open.addEventListener('click', () => openProject(project.directory));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'recent-remove';
    remove.dataset.directory = project.directory;
    remove.setAttribute('aria-label', `Убрать «${project.label}» из недавних проектов`);
    remove.title = 'Убрать из списка';
    remove.append(icon('close'));
    remove.addEventListener('click', () => runAction('removing', 'Обновляем список проектов…', 'recent/remove', { directory: project.directory }, () => {
      state.recent = state.recent.filter((item) => item.directory !== project.directory);
      renderRecent();
      byId('recent-heading').focus({ preventScroll: true });
      announce('Проект убран из списка недавних. Файлы сохранены.');
    }));
    row.append(open, remove);
    list.append(row);
  }
  byId('recent-loading').hidden = true;
  byId('recent-empty').hidden = state.recent.length > 0;
  list.hidden = state.recent.length === 0;
  byId('recent-count').textContent = String(state.recent.length);
  byId('recent-count').hidden = state.recent.length === 0;
  if (focusedDirectory) {
    const replacement = [...list.querySelectorAll('button')].find((button) => button.dataset.directory === focusedDirectory && button.className === focusedClass);
    replacement?.focus({ preventScroll: true });
  }
}

connect();
