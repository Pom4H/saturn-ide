import type { Workspace } from './files';
export async function execute(argv: string[], cwd: string, timeout = 15000): Promise<string> {
  const process = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...Bun.env, GIT_TERMINAL_PROMPT: '0' } });
  let expired = false;
  const timer = setTimeout(() => { expired = true; process.kill(); }, timeout);
  try {
    const [out, err, code] = await Promise.all([new Response(process.stdout).text(), new Response(process.stderr).text(), process.exited]);
    if (expired) throw new Error('Command timed out');
    if (code !== 0) throw new Error((err || out || `Command exited ${code}`).slice(0, 4000));
    return out.slice(0, 100_000);
  } finally { clearTimeout(timer); }
}
export class Git {
  constructor(readonly workspace: Workspace) {}
  private run(...args: string[]) { return execute(['git', ...args], this.workspace.root); }
  async status() {
    try {
      const [branch, status, log, remotes, diff] = await Promise.all([
        this.run('branch', '--show-current'), this.run('status', '--porcelain=v1', '--', '.'),
        this.run('log', '-5', '--format=%h %s', '--', '.').catch(() => ''), this.run('remote'),
        this.run('diff', 'HEAD', '--', '.').catch(() => ''),
      ]);
      return { available: true, branch: branch.trim() || 'detached', status, log, remotes: remotes.trim(), diff };
    } catch { return { available: false, branch: '', status: '', log: '', remotes: '', diff: '' }; }
  }
  async action(action: string, message?: string) {
    if (action === 'init') await this.run('init', '-b', 'main');
    else if (action === 'commit') {
      if (!message?.trim() || message.length > 500) throw new Error('A commit message is required');
      await this.run('add', '--', '.'); await this.run('commit', '--only', '-m', message, '--', '.');
    } else if (action === 'pull') {
      if ((await this.run('status', '--porcelain')).trim()) throw new Error('Commit or stash changes before pulling');
      await this.run('pull', '--ff-only');
    } else if (action === 'push') await this.run('push');
    else throw new Error('Unsupported Git action');
    return this.status();
  }
}
