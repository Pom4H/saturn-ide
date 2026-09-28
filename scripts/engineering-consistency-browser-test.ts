import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fixture } from '../tests/helpers';
import { createApp } from '../src/host/dev';
import { isAttached } from '../src/core';

const project = fixture(), app = await createApp({ projectDir: project.root, dataDir: project.dir, databaseUrl: ':memory:', port: 0 });
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const wait = async (condition: () => Promise<boolean>, message: string) => { for (let i = 0; i < 100; i++) { if (await condition().catch(() => false)) return; await Bun.sleep(150); } throw new Error(message); };
const center = async (selector: string) => { const box = await page.locator(selector).boundingBox(); assert(box, `Missing ${selector}`); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
const port = (end: unknown) => end && isAttached(end as Parameters<typeof isAttached>[0]) ? (end as { port: string }).port : undefined;
try {
  mkdirSync('artifacts/engineering-consistency', { recursive: true });
  await page.goto(app.server.url.href); await page.locator('[data-equipment="PLC-01"]').waitFor();
  await page.getByRole('button', { name: /^(Edit|Правка)$/ }).click();
  const from = await center('[data-cable-plug="run-command.from"]'), to = await center('[data-equipment="PLC-01"] [data-port="DO2"]');
  await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 12 });
  assert(await page.locator('[data-compatible-port]').count() === 2, '2D port hints are not restricted to compatible endpoints');
  assert(await page.locator('[data-compatible-port="PLC-01.DO2"][data-snap-target="true"]').count() === 1, '2D compatible port does not snap');
  await page.screenshot({ path: 'artifacts/engineering-consistency/drag-2d.png' }); await page.mouse.up();
  await wait(async () => port(app.state().project.cables?.find(edge => edge.id === 'run-command')?.from) === 'DO2', '2D rewire did not save');
  await wait(async () => await page.locator('[data-cable="run-command"]').getAttribute('data-route-valid') === 'true', 'Saved 2D route is not valid');
  assert(await page.locator('[data-route-issue="true"]').count()===0,'Saved 2D route still reports a routing issue');
  await page.screenshot({ path: 'artifacts/engineering-consistency/saved-2d.png' });
  await page.getByRole('button', { name: '3D', exact: true }).click(); await page.locator('.scene3d canvas').waitFor();
  await wait(async () => Number(await page.locator('.scene3d').getAttribute('data-frames')) > 10, '3D did not render');
  const projected = await page.locator('.scene3d').evaluate(node => ({
    plugs: JSON.parse((node as HTMLElement).dataset.cablePlugs ?? '[]') as { id: string; end: string; x: number; y: number }[],
    ports: JSON.parse((node as HTMLElement).dataset.portScreens ?? '[]') as { device: string; port: string; x: number; y: number }[],
  }));
  const plug = projected.plugs.find(item => item.id === 'run-command' && item.end === 'from');
  const target = projected.ports.find(item => item.device === 'PLC-01' && item.port === 'DO1');
  assert(plug && target, '3D plug or target projection is missing');
  await page.mouse.move(plug.x, plug.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 12 });
  assert(await page.locator('.scene3d').getAttribute('data-connection-target') === 'PLC-01.DO1', '3D compatible target is not selected');
  await page.locator('.scene3d-compatible').getByText('PLC-01.DO1', { exact: false }).waitFor();
  await page.screenshot({ path: 'artifacts/engineering-consistency/drag-3d.png' }); await page.mouse.up();
  await wait(async () => port(app.state().project.cables?.find(edge => edge.id === 'run-command')?.from) === 'DO1', '3D rewire did not save');
  await wait(async () => await page.locator('.scene3d').getAttribute('data-invalid-routes') === '0', 'Saved 3D route still reports a routing issue');
  await page.screenshot({ path: 'artifacts/engineering-consistency/saved-3d.png' });
  assert(errors.length === 0, `Browser errors: ${errors.join('; ')}`);
  console.log('PASS 2D/3D compatible ports, visual snap hints and persisted authored rewires; no page errors');
} finally { await browser.close(); await app.close(); project.clean(); }
