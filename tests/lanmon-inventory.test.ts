import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { inspectLanmon } from '../src/shell/importers/lanmon';

const inspect = (paths: string[]) => inspectLanmon('project.zip', 'sha256', paths.map(path => ({ path, bytes: 1 })));
test('Lanmon format adapter preserves every supported extension and case handling', () => {
  const groups = {
    configuration: ['ini', 'cfg', 'xml', 'json', 'csv', 'dat'], screen: ['lm2', 'map', 'lm4'],
    script: ['pas', 'bas', 'vb', 'cpp', 'js', 'vbs'], report: ['fr3', 'frf'], asset: ['bmp', 'png', 'jpg', 'ico', 'wav', 'avi'],
  };
  for (const [kind, extensions] of Object.entries(groups)) {
    assert.deepEqual(inspect(extensions.map(ext => `FILE.${ext.toUpperCase()}`)).files.map(file => file.kind), extensions.map(() => kind));
  }
  assert.deepEqual(inspect(['unknown.bin', 'plain', 'file.__proto__']).files.map(file => file.kind), ['unsupported', 'unsupported', 'unsupported']);
});

test('format inventory keeps credentials and script bodies out of output', () => {
  const result = inspectLanmon('legacy.zip', 'digest', [
    { path: 'LANMON.INI', bytes: 100, text: '[NETWORK]\nPassword=secret-value\n[MAP]\nMAP0=main.lm2\n' },
    { path: 'main.cpp', bytes: 20, text: 'dangerous();' },
    { path: 'other.vbs', bytes: 10, text: 'password=secret-value' },
    { path: 'main.lm2', bytes: 1 }, { path: 'daily.fr3', bytes: 1 },
  ]);
  assert.deepEqual(result.files[0]!.sections, ['NETWORK', 'MAP']);
  assert.deepEqual(result.files[0]!.references, ['main.lm2']);
  assert.doesNotMatch(JSON.stringify(result), /secret-value|dangerous/);
  assert.equal(result.warnings.filter(warning => warning.startsWith('Скрипты')).length, 1);
  assert.equal(result.warnings.length, 4);
});

test('inventory limits and missing-root warning are preserved', () => {
  assert.throws(() => inspect(Array.from({ length: 1001 }, (_, i) => `${i}.ini`)), /1000/);
  assert.ok(inspect(['project.ini']).warnings.some(warning => warning.includes('LANMON.INI не найден')));
  const result = inspectLanmon('legacy.ini', 'digest', [{ path: 'LANMON.INI', bytes: 1,
    text: Array.from({ length: 120 }, (_, i) => `[SECTION${i}]\nMAP${i}=map${i}.lm2`).join('\n') }]);
  assert.equal(result.files[0]!.sections.length, 80);
  assert.equal(result.files[0]!.references.length, 100);
});
