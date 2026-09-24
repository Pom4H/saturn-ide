/** @jsxImportSource @opentui/react */
import { expect, test } from 'bun:test';
import { act } from 'react';
import { testRender } from '@opentui/react/test-utils';
import { TerminalView } from '../src/shell/terminal';
import { ShellSession } from '../src/shell/model/session';
import { ShellClient } from '../src/shell/client';
import { resourceUri } from '../src/core/resources';
import type { IDEState } from '../src/protocol';
import project from '@saturn/example';

test('actual OpenTUI React renderer shows the shared document after a Shell command', async () => {
  const uri = resourceUri(project.id, 'device', 'P-01');
  let source = 'const speed = 1450;', version = 0;
  const session = new ShellSession('terminal', {
    read: async path => ({ path, source, version: String(version) }),
    save: async file => { source = file.source; return { ...file, version: String(++version) }; },
  });
  session.replaceCatalog({ project: project.id, revision: 'test', resources: [{ uri, kind: 'device', icon: 'pump', entityId: 'P-01', name: { en: 'Booster', ru: 'Насос' }, source: { path: 'equipment/P-01.device.ts' }, editors: ['diagram', 'source', 'signals'], related: [] }] });
  await session.execute({ type: 'open', uri, editor: 'source' });
  const state: IDEState = { project, positions: {}, problems: [], revision: 'test', snapshot: { samples: {}, alarms: {} }, mode: 'simulation', adapter: 'sqlite', key: '', pushPublicKey: '' };
  const setup = await testRender(<TerminalView client={new ShellClient('http://127.0.0.1:1')} session={session} state={state} connected={false} quit={() => {}}/>, { width: 110, height: 28 });
  try {
    await setup.renderOnce();
    expect(setup.captureCharFrame()).toContain('Saturn');
    expect(setup.captureCharFrame()).toContain('[PMP]');
    expect(setup.captureCharFrame()).toContain('1450');
    await act(async () => { session.documents.edit('equipment/P-01.device.ts', 'const speed = 1200;'); await session.execute({ type: 'save' }); });
    await setup.renderOnce();
    expect(source).toBe('const speed = 1200;');
    expect(setup.captureCharFrame()).toContain('1200');
  } finally { setup.renderer.destroy(); }
});
