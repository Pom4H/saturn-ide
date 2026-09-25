import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from '../scripts/architecture-check.mjs';
test('runtime rejects workspace/compiler/UI dependencies', () => {
  for (const source of ["import {x} from '../workspace/build'", "import ts from 'typescript'", "import {x} from '../shell/app'", 'Bun.build({})']) {
    assert.equal(violations({'src/runtime/bad.ts':source}).length, 1);
  }
});
test('workspace and Shell do not own runtime; host composes them', () => {
  assert.equal(violations({'src/shell/bad.ts':"import { Runtime } from '../runtime/engine'"}).length,1);
  assert.equal(violations({'src/workspace/bad.ts':"import '../runtime/engine'"}).length,1);
  assert.deepEqual(violations({'src/host/dev.ts':"import '../workspace/build'; import '../runtime/engine'; import '../shell/index.html'"}),[]);
  assert.equal(violations({'src/host/browser.tsx':"import '../../project/plugins/saturn-plc500/hmi/wasm-display'"}).length,1);
  assert.equal(violations({'src/shell/bad.ts':"import '../../project/plugins/saturn-plc500/hmi/wasm-display'"}).length,1);
});
test('pure model must stay browser/runtime independent and explicitly typed', () => {
  assert.equal(violations({'src/core.ts':"import React from 'react'"}).length,1);
  assert.equal(violations({'src/core/example.ts':'const x: any = 1;'}).length,1);
});
