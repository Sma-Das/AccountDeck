import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Exercise the same TypeScript selector bundled into the browser, without a DOM.
const source = await readFile(
  new URL('../src/limit-display.ts', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  },
}).outputText;
const { displayWindow, emptyLimitDisplay } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('account summaries and reset sorting prefer the overall weekly limit over model allowances', () => {
  const model = {
    id: 'iguana_necktie',
    label: '7-day Fable',
    remaining: 100,
    periodHours: 168,
    resetsAt: '2026-11-05T07:59:00Z',
  };
  const week = {
    id: 'seven_day',
    label: '7-day limit',
    remaining: 86,
    periodHours: 168,
    resetsAt: '2026-10-13T02:00:00Z',
  };
  const account = {
    id: 'claude-1',
    provider: 'claude',
    quota: { windows: [model, week] },
  };
  assert.equal(displayWindow(account, emptyLimitDisplay), week);
  assert.equal(
    displayWindow(account, {
      providers: [],
      accounts: { 'claude-1': { hidden: false, windows: ['seven_day'] } },
    }),
    model,
  );
  assert.equal(
    displayWindow(account, { providers: ['claude'], accounts: {} }),
    undefined,
  );
  const codex = {
    id: 'codex-1',
    provider: 'codex',
    quota: {
      windows: [
        { id: 'primary_window', periodHours: 5 },
        { id: 'secondary_window', periodHours: 168 },
      ],
    },
  };
  assert.equal(displayWindow(codex, emptyLimitDisplay).id, 'secondary_window');
});
