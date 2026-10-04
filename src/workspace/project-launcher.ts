import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProject } from './project-template';
import { execute, Git } from './git';
import { Workspace } from './files';

/** Only filesystem locations are discovered here; reading a folder never executes project.ts. */
export interface ProjectDirectory { directory: string; label: string; relative: string }
export interface DiscoveredProjects { directory: string; projects: ProjectDirectory[]; limited: boolean }
export class ProjectLauncherError extends Error {
  constructor(message: string, readonly code = 'INVALID_PROJECT', readonly status = 400, readonly directory?: string) { super(message); }
}

export function localDirectory(value: string, cwd = process.cwd()): string {
  if (!value.trim() || value.length > 4096 || /[\x00-\x1f]/.test(value)) throw new ProjectLauncherError('Укажите путь к папке.');
  const input = value.trim(), expanded = input === '~' ? homedir() : /^~[\\/]/.test(input) ? join(homedir(), input.slice(2)) : input;
  const directory = resolve(cwd, expanded);
  try {
    if (!statSync(directory).isDirectory()) throw new Error('not a directory');
    return realpathSync(directory);
  } catch { throw new ProjectLauncherError('Папка не найдена или недоступна. Проверьте путь и попробуйте снова.', 'DIRECTORY_NOT_FOUND', 404); }
}

export function hasProject(directory: string): boolean {
  try { const entry = lstatSync(join(directory, 'project.ts')); return entry.isFile() && !entry.isSymbolicLink(); }
  catch { return false; }
}

export function projectDirectory(value: string, cwd?: string): string {
  const directory = localDirectory(value, cwd);
  if (!hasProject(directory)) throw new ProjectLauncherError('В этой папке нет project.ts. Выберите папку проекта или найдите проекты внутри репозитория.', 'PROJECT_NOT_FOUND', 404);
  return directory;
}

export function newProjectDestination(parent: string, name: string, cwd?: string): string {
  const folder = name.trim();
  if (!folder || folder.length > 100 || folder === '.' || folder === '..' || /[<>:"/\\|?*\x00-\x1f]/.test(folder) || /[. ]$/.test(folder) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder)) {
    throw new ProjectLauncherError('Введите название новой папки: до 100 символов, без /, \\ и служебных символов.', 'INVALID_NAME');
  }
  const target = join(localDirectory(parent, cwd), folder);
  // lstat also catches broken symlinks, which must never be treated as free destinations.
  try { lstatSync(target); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target; throw new ProjectLauncherError('Не удалось проверить папку назначения. Проверьте права доступа.', 'DESTINATION_UNAVAILABLE'); }
  throw new ProjectLauncherError('Папка с таким именем уже существует. Выберите другое имя или откройте существующую папку.', 'DESTINATION_EXISTS', 409);
}

export function discoverProjects(value: string, cwd?: string): DiscoveredProjects {
  const directory = localDirectory(value, cwd), projects: ProjectDirectory[] = [];
  let visited = 0, limited = false;
  const walk = (root: string, depth: number): void => {
    if (++visited > 2500 || projects.length >= 100) { limited = true; return; }
    if (hasProject(root)) projects.push({ directory: root, label: basename(root), relative: relative(directory, root).split(sep).join('/') || '.' });
    let entries: string[];
    try { entries = readdirSync(root); } catch { return; }
    for (const name of entries.sort()) {
      if (name.startsWith('.') || ['node_modules', 'vendor', 'dist', 'build', 'coverage'].includes(name)) continue;
      let entry;
      try { entry = lstatSync(join(root, name)); } catch { continue; }
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      if (depth >= 3) { limited = true; continue; }
      walk(join(root, name), depth + 1);
      if (visited > 2500 || projects.length >= 100) break;
    }
  };
  walk(directory, 0);
  return { directory, projects, limited };
}

export async function createLocalProject(parent: string, name: string, cwd?: string): Promise<string> {
  const directory = newProjectDestination(parent, name, cwd);
  const gitAvailable = await execute(['git', '--version'], localDirectory(parent, cwd)).then(() => true, () => false);
  try { createProject(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' || error instanceof Error && error.message === 'Destination already exists') throw new ProjectLauncherError('Папка с таким именем уже существует. Выберите другое имя.', 'DESTINATION_EXISTS', 409);
    const created = existsSync(directory);
    throw new ProjectLauncherError(created ? 'Папка создана, но файлы проекта записаны не полностью. Проверьте права записи и свободное место; созданные файлы сохранены.' : 'Не удалось создать проект. Проверьте права записи и свободное место.', 'CREATE_FAILED', 500, created ? directory : undefined);
  }
  if (!gitAvailable) return directory;
  try {
    const inherited = await execute(['git', 'rev-parse', '--is-inside-work-tree'], directory).then(result => result.trim() === 'true', () => false);
    if (!inherited) await new Git(new Workspace(directory)).action('init');
  }
  catch { throw new ProjectLauncherError('Файлы проекта созданы, но Git не удалось инициализировать. Откройте созданную папку и настройте Git в IDE.', 'GIT_INIT', 500, directory); }
  return directory;
}

/** HTTPS/SSH credentials stay in the local Git helper; they never enter source or recent-project metadata. */
export function repositoryAddress(value: string, cwd = process.cwd()): string {
  const address = value.trim();
  if (!address || address.length > 2048 || /[\x00-\x1f]/.test(address) || address.startsWith('-')) throw new ProjectLauncherError('Укажите HTTPS- или SSH-адрес репозитория либо путь к локальному Git-репозиторию.', 'INVALID_REPOSITORY');
  if (isAbsolute(address) || /^(\.\.?[\\/]|~[\\/])/.test(address)) return localDirectory(address, cwd);
  if (/\s/.test(address)) throw new ProjectLauncherError('Адрес репозитория не должен содержать пробелы.', 'INVALID_REPOSITORY');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(address)) {
    let url: URL;
    try { url = new URL(address); } catch { throw new ProjectLauncherError('Проверьте адрес репозитория.', 'INVALID_REPOSITORY'); }
    if (url.password || url.search || url.hash || url.protocol === 'https:' && url.username) throw new ProjectLauncherError('Укажите адрес без пароля, токена и параметров. Для доступа используются настройки Git на этом компьютере.', 'REPOSITORY_CREDENTIALS');
    if (url.protocol === 'file:' && !url.username && (!url.hostname || url.hostname === 'localhost')) {
      try { return localDirectory(fileURLToPath(url), cwd); } catch { throw new ProjectLauncherError('Локальный репозиторий не найден. Проверьте путь.', 'INVALID_REPOSITORY'); }
    }
    if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname || url.pathname === '/' || url.protocol === 'ssh:' && url.username && !/^[a-z_][a-z0-9._-]*$/i.test(url.username)) throw new ProjectLauncherError('Поддерживаются HTTPS- и SSH-адреса репозиториев.', 'INVALID_REPOSITORY');
    return url.href;
  }
  if (/^[a-z_][a-z0-9._-]*@[a-z0-9.-]+:[a-z0-9_./~-]+$/i.test(address)) return address;
  throw new ProjectLauncherError('Укажите полный адрес, например https://github.com/owner/project.git.', 'INVALID_REPOSITORY');
}

function cloneFailure(stderr: string): ProjectLauncherError {
  if (/permission denied|authentication failed|could not read username|terminal prompts disabled|host key verification|publickey/i.test(stderr)) return new ProjectLauncherError('Git не смог авторизоваться. Проверьте доступ к репозиторию и настройте Git или SSH на этом компьютере, затем повторите.', 'GIT_AUTH', 422);
  if (/not found|does not exist|does not appear to be|not a git repository/i.test(stderr)) return new ProjectLauncherError('Репозиторий не найден или недоступен. Проверьте адрес и права доступа, затем повторите.', 'REPOSITORY_NOT_FOUND', 422);
  return new ProjectLauncherError('Не удалось клонировать репозиторий. Проверьте адрес, доступ к сети и настройки Git, затем повторите.', 'CLONE_FAILED', 422);
}

export async function cloneProjectRepository(parent: string, name: string, repository: string, options: { cwd?: string; signal?: AbortSignal; timeout?: number } = {}): Promise<DiscoveredProjects> {
  const cwd = options.cwd ?? process.cwd(), address = repositoryAddress(repository, cwd), target = newProjectDestination(parent, name, cwd);
  const temporary = mkdtempSync(join(localDirectory(parent, cwd), '.saturn-clone-')), checkout = join(temporary, 'checkout'), hooks = join(temporary, 'hooks');
  mkdirSync(hooks);
  let expired = false;
  const cancellation = () => new ProjectLauncherError('Клонирование отменено. Можно изменить параметры и попробовать снова.', 'CLONE_CANCELLED', 409);
  try {
    if (options.signal?.aborted) throw cancellation();
    let child: Bun.Subprocess<'ignore', 'ignore', 'pipe'>;
    try {
      child = Bun.spawn(['git', '-c', 'protocol.ext.allow=never', '-c', `core.hooksPath=${hooks}`, 'clone', '--no-recurse-submodules', '--no-hardlinks', '--', address, checkout], {
        cwd: temporary, stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', detached: process.platform !== 'win32',
        env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15' },
      });
    } catch { throw new ProjectLauncherError('Git не найден. Установите Git и перезапустите Saturn.', 'GIT_UNAVAILABLE', 503); }
    const kill = () => { try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); } }, timer = setTimeout(() => { expired = true; kill(); }, options.timeout ?? 90_000);
    options.signal?.addEventListener('abort', kill, { once: true });
    let code: number, stderr: string;
    try {
      // Drain the pipe concurrently with exit so large Git errors cannot deadlock the operation.
      [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', kill); }
    if (options.signal?.aborted) throw cancellation();
    if (expired) throw new ProjectLauncherError('Git не ответил за отведённое время. Проверьте сеть и доступ, затем попробуйте снова.', 'CLONE_TIMEOUT', 408);
    if (code !== 0) throw cloneFailure(stderr);
    // An exclusive mkdir prevents merging a clone into an existing folder, including one
    // created while Git was running. The copy never replaces an existing file.
    try { mkdirSync(target); }
    catch { throw new ProjectLauncherError('Папка назначения уже существует или недоступна. Выберите другую папку.', 'DESTINATION_EXISTS', 409); }
    try { for (const entry of readdirSync(checkout)) cpSync(join(checkout, entry), join(target, entry), { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: true }); }
    catch { throw new ProjectLauncherError('Не удалось полностью записать локальную копию. Проверьте свободное место и выберите новую папку назначения.', 'CLONE_COPY_FAILED', 500, target); }
    return discoverProjects(target);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
