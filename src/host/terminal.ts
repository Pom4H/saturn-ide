import { createElement } from 'react';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { TerminalApp } from '../shell/terminal';
import { ShellClient } from '../shell/client';

/** Attach to the same workspace server. Exiting this shell never stops its runtime. */
export async function runTerminal(base = 'http://127.0.0.1:3000', consoleOnly = false): Promise<void> {
  const url = new URL(base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Expected an HTTP(S) workspace URL without credentials');
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Terminal Shell requires a TTY; use bun shell:list for plain output');
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);
  await new Promise<void>(resolve => {
    let closed = false;
    const quit = () => { if (closed) return; closed = true; process.off('SIGTERM', quit); root.unmount(); renderer.destroy(); resolve(); };
    process.once('SIGTERM', quit);
    root.render(createElement(TerminalApp, { client: new ShellClient(url.origin), quit, consoleOnly }));
  });
}
if (import.meta.main) await runTerminal(Bun.argv[2]);
