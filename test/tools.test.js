import { test } from 'node:test';
import assert from 'node:assert';
import { TOOLS, findTool, listToolsForResponse } from '../src/tools.js';

test('every tool is well-formed', () => {
  assert.ok(TOOLS.length >= 10, 'at least 10 tools');
  for (const t of TOOLS) {
    assert.ok(t.name && t.name.startsWith('sigil_'), `name: ${t.name}`);
    assert.ok(typeof t.description === 'string' && t.description.length > 80, `description: ${t.name}`);
    assert.equal(t.inputSchema.type, 'object', `inputSchema: ${t.name}`);
    assert.equal(typeof t.call, 'function', `call: ${t.name}`);
  }
});

test('tool names are unique', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length);
});

test('findTool resolves known and rejects unknown', () => {
  assert.ok(findTool('sigil_verify_supply_path'));
  assert.equal(findTool('does_not_exist'), null);
});

test('listToolsForResponse omits the call function', () => {
  for (const t of listToolsForResponse()) {
    assert.equal(t.call, undefined);
    assert.ok(t.name && t.description && t.inputSchema);
  }
});
