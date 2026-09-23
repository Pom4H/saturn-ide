import { test } from 'node:test';
import assert from 'node:assert/strict';
import { violations } from '../scripts/architecture-check.mjs';
test('headless Shell cannot import React, DOM adapters or runtime authority', () => {
  for (const source of ['import React from "react";', 'import "../terminal";', 'import "../../runtime/engine";', 'window.addEventListener("resize", () => {});']) {
    assert.ok(violations({ 'src/shell/model/example.ts': source }).length > 0, source);
  }
});
test('headless Shell consumes only model contracts and its own document logic', () => {
  assert.deepEqual(violations({ 'src/shell/model/example.ts': 'import type { ProjectResource } from "../../core/resources"; import { Documents } from "./documents";' }), []);
});
