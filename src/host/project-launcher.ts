import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { cloneProjectRepository, createLocalProject, discoverProjects, hasProject, projectDirectory, ProjectLauncherError } from '../workspace/project-launcher';
import { createApp, type DevelopmentApp } from './dev';

interface RecentDirectory { directory: string; label: string; available: boolean }
interface LauncherOperation { id: string; phase: 'cloning' | 'opening'; message: string }
export interface ProjectLauncherOptions { port?: number; initialDirectory?: string; selectDirectory?: boolean; dataDir?: string; appRoot?: string; preview?: 'manual' | 'simulation'; cloneTimeout?: number }

/** A local entry screen. Workspaces, source, Git and runtimes keep their existing owners. */
export async function createProjectLauncher(options: ProjectLauncherOptions = {}) {
  const initialDirectory = resolve(options.initialDirectory ?? process.cwd()), appRoot = options.appRoot ?? resolve(import.meta.dir, '../..');
  const dataDir = options.dataDir ?? join(homedir(), '.saturn'), recentsFile = join(dataDir, 'recent-projects.json');
  let defaultDirectory = initialDirectory === appRoot ? dirname(appRoot) : initialDirectory;
  while (!existsSync(defaultDirectory) || !statSync(defaultDirectory).isDirectory()) {
    const parent = dirname(defaultDirectory);
    if (parent === defaultDirectory) { defaultDirectory = homedir(); break; }
    defaultDirectory = parent;
  }
  const assets = new Map([
    ['/', { content: await Bun.file(join(appRoot, 'src/launcher/index.html')).text(), type: 'text/html; charset=utf-8' }],
    ['/launcher.css', { content: await Bun.file(join(appRoot, 'src/launcher/styles.css')).text(), type: 'text/css; charset=utf-8' }],
    ['/launcher.js', { content: await Bun.file(join(appRoot, 'src/launcher/client.js')).text(), type: 'text/javascript; charset=utf-8' }],
  ]);
  const key = crypto.randomUUID(), children = new Map<string, Promise<DevelopmentApp>>();
  let operation: LauncherOperation | undefined, cloneController: AbortController | undefined, activeOperation: Promise<Response> | undefined, closed = false;
  let completedClone: { id: string; directory: string } | undefined;
  let failedClone: { id: string; error: string; code: string } | undefined;
  const completedDiscovery = () => { try { return completedClone ? { id: completedClone.id, ...discoverProjects(completedClone.directory) } : undefined; } catch { return undefined; } };
  const recentDirectories = (): string[] => {
    try {
      if (statSync(recentsFile).size > 65536) return [];
      const saved: unknown = JSON.parse(readFileSync(recentsFile, 'utf8'));
      return Array.isArray(saved) ? saved.filter((path): path is string => typeof path === 'string' && path.length <= 4096 && path === resolve(path)).slice(0, 12) : [];
    } catch { return []; }
  };
  const recent = (): RecentDirectory[] => recentDirectories().map(directory => ({ directory, label: basename(directory), available: hasProject(directory) }));
  const saveRecent = (directories: string[]) => {
    mkdirSync(dataDir, { recursive: true });
    const temporary = join(dataDir, `.recent-${crypto.randomUUID()}.json`);
    writeFileSync(temporary, JSON.stringify([...new Set(directories)].slice(0, 12)) + '\n', { mode: 0o600 });
    renameSync(temporary, recentsFile);
  };
  const remember = (directory: string) => { try { saveRecent([directory, ...recentDirectories()]); } catch { /* A read-only preferences directory must not block an opened project. */ } };
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  const open = async (value: string) => {
    const directory = projectDirectory(value, defaultDirectory);
    operation = { id: crypto.randomUUID(), phase: 'opening', message: 'Открываем проект и проверяем исходники…' };
    let pending = children.get(directory);
    if (!pending) {
      const workspaceData = join(dataDir, 'workspaces', new Bun.CryptoHasher('sha256').update(directory).digest('hex').slice(0, 16));
      pending = createApp({ appRoot, projectDir: directory, dataDir: workspaceData, port: 0, preview: options.preview, demoLauncher: true, launcherUrl: server.url.href });
      children.set(directory, pending);
      void pending.catch(() => children.delete(directory));
    }
    let app: DevelopmentApp;
    try { app = await pending; }
    catch { throw new ProjectLauncherError('Не удалось открыть проект. Проверьте зависимости и файлы browser.ts / server.ts, затем повторите.', 'OPEN_FAILED', 422, directory); }
    if (closed) { await app.close(); throw new ProjectLauncherError('Saturn завершает работу.', 'CLOSING', 503); }
    remember(directory);
    return { directory, url: app.server.url.href };
  };
  const field = (body: Record<string, unknown>, name: string) => {
    if (typeof body[name] !== 'string') throw new ProjectLauncherError('Проверьте заполнение полей формы.', 'INVALID_FORM');
    return body[name] as string;
  };
  const server = Bun.serve({ hostname: '127.0.0.1', port: options.port ?? 3000, idleTimeout: 0, maxRequestBodySize: 16_384,
    async fetch(request): Promise<Response> {
      try {
        if (closed) throw new ProjectLauncherError('Saturn завершает работу.', 'CLOSING', 503);
        const url = new URL(request.url), origin = request.headers.get('Origin');
        // Exact loopback host + port blocks DNS rebinding. Origin and an unguessable
        // per-launch key fence filesystem writes, including clone and recent removal.
        const trustedHost = [server.url.host, `localhost:${server.port}`].includes(url.host);
        if (!trustedHost || request.headers.get('Host') !== url.host || origin && origin !== url.origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') throw new ProjectLauncherError('Запрос с другого сайта отклонён.', 'UNTRUSTED_ORIGIN', 403);
        if (request.method === 'GET') {
          if (url.pathname === '/api/launcher') return json({ key, defaultDirectory, initialPath: options.selectDirectory ? initialDirectory : undefined, notice: options.selectDirectory ? 'В выбранной папке не найден project.ts. Найдите проект внутри или создайте новый.' : undefined, recent: recent(), operation, completedClone: completedDiscovery(), failedClone, separator: sep });
          const asset = assets.get(url.pathname);
          if (asset) return new Response(asset.content, { headers: { 'Content-Type': asset.type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'" } });
          if (url.pathname === '/favicon.ico') return new Response(null, { status: 204 });
          return json({ error: 'Страница не найдена.' }, 404);
        }
        if (request.method !== 'POST') return json({ error: 'Метод не поддерживается.' }, 405);
        if (origin !== url.origin || request.headers.get('X-Saturn-Key') !== key || !request.headers.get('Content-Type')?.startsWith('application/json')) throw new ProjectLauncherError('Сессия устарела. Обновите страницу и повторите действие.', 'INVALID_SESSION', 403);
        let body: unknown;
        try { body = await request.json(); } catch { throw new ProjectLauncherError('Не удалось прочитать форму. Повторите действие.', 'INVALID_FORM'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProjectLauncherError('Проверьте заполнение полей формы.', 'INVALID_FORM');
        const values = body as Record<string, unknown>;
        if (url.pathname === '/api/launcher/cancel') { const cancelled = !!cloneController; cloneController?.abort(); return json({ cancelled }); }
        if (operation) throw new ProjectLauncherError('Дождитесь текущего действия или отмените клонирование.', 'BUSY', 409);
        const run = async (): Promise<Response> => {
          try {
            if (url.pathname === '/api/launcher/discover') return json(discoverProjects(field(values, 'directory'), defaultDirectory));
            if (url.pathname === '/api/launcher/open') return json(await open(field(values, 'directory')));
            if (url.pathname === '/api/launcher/create') {
              operation = { id: crypto.randomUUID(), phase: 'opening', message: 'Создаём проект и локальный Git-репозиторий…' };
              const directory = await createLocalProject(field(values, 'parent'), field(values, 'name'), defaultDirectory);
              return json(await open(directory));
            }
            if (url.pathname === '/api/launcher/clone') {
              operation = { id: crypto.randomUUID(), phase: 'cloning', message: 'Клонируем репозиторий в новую папку…' };
              const id = operation.id;
              completedClone = undefined; failedClone = undefined;
              cloneController = new AbortController();
              try {
                const discovered = await cloneProjectRepository(field(values, 'parent'), field(values, 'name'), field(values, 'repository'), { cwd: defaultDirectory, signal: cloneController.signal, timeout: options.cloneTimeout });
                completedClone = { id, directory: discovered.directory };
                return json({ id, ...discovered });
              } catch (error) {
                failedClone = { id, error: error instanceof ProjectLauncherError ? error.message : 'Не удалось клонировать репозиторий. Повторите действие.', code: error instanceof ProjectLauncherError ? error.code : 'CLONE_FAILED' };
                throw error;
              }
            }
            if (url.pathname === '/api/launcher/recent/remove') { const directory = field(values, 'directory'); saveRecent(recentDirectories().filter(item => item !== directory)); return json({ recent: recent() }); }
            return json({ error: 'Действие не найдено.' }, 404);
          } finally { operation = undefined; cloneController = undefined; }
        };
        activeOperation = run();
        try { return await activeOperation; } finally { activeOperation = undefined; }
      } catch (error) {
        if (error instanceof ProjectLauncherError) return json({ error: error.message, code: error.code, directory: error.directory }, error.status);
        return json({ error: 'Не удалось выполнить действие. Проверьте доступ к папке и попробуйте снова.', code: 'LAUNCHER_ERROR' }, 500);
      }
    },
  });
  return { server, async close() {
    if (closed) return; closed = true; cloneController?.abort();
    await activeOperation?.catch(() => {});
    await Promise.allSettled([...children.values()].map(async pending => (await pending).close()));
    children.clear(); await server.stop(true);
  } };
}
