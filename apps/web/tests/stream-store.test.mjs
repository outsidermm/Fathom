import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

let moduleId = 0;
async function setup(t) {
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor() { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close() { this.readyState = 3; this.onclose?.(); }
    message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
  }
  const original = { window: globalThis.window, WebSocket: globalThis.WebSocket };
  globalThis.window = {};
  globalThis.WebSocket = Socket;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [] }));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const source = await readFile(new URL('../src/lib/stream-store.ts', import.meta.url), 'utf8');
  // Exercise the production store with only its imports resolved for Node.
  const resolved = source
    .replace('"zustand"', JSON.stringify(import.meta.resolve('zustand')))
    .replace('"@/lib/contract"', JSON.stringify(new URL('../src/lib/contract.ts', import.meta.url).href));
  const { outputText } = ts.transpileModule(resolved, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const store = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}#${moduleId++}`);
  const unmount = store.mountStreamConnection();
  t.after(() => { unmount(); Object.assign(globalThis, original); });
  return { sockets, state: store.useStreamStore.getState, unmount };
}

test('Stop cancels a queued rerun before its socket opens', async (t) => {
  const { sockets, state } = await setup(t);
  sockets[0].open();
  state().start('first', 'qwen2.5-7b');
  sockets[0].message({ type: 'status', state: 'done' });
  state().rerun();
  state().stop();
  sockets[1].open();
  assert.equal(sockets[1].sent.filter(m => m.type === 'start').length, 0);
  assert.equal(state().runs.at(-1).status, 'stopped');
});

test('failed connection does not replay a queued generation marked as error', async (t) => {
  const { sockets, state } = await setup(t);
  sockets[0].open();
  state().start('first', 'qwen2.5-7b');
  sockets[0].message({ type: 'status', state: 'done' });
  state().rerun();
  sockets[1].close();
  t.mock.timers.tick(500);
  sockets[2].open();
  assert.equal(state().runs.at(-1).status, 'error');
  assert.equal(sockets[2].sent.filter(m => m.type === 'start').length, 0);
});

test('starting during backoff leaves exactly one socket and ignores stale events', async (t) => {
  const { sockets, state } = await setup(t);
  sockets[0].open();
  state().start('first', 'qwen2.5-7b');
  sockets[0].close();
  state().start('second', 'qwen2.5-7b');
  sockets[1].open();
  t.mock.timers.tick(500);
  assert.equal(sockets.length, 2);
  sockets[0].message({ type: 'token', index: 0, position: 0, text: 'stale' });
  sockets[1].message({ type: 'token', index: 0, position: 0, text: 'fresh' });
  assert.deepEqual(state().runs.at(-1).tokens, [{ index: 0, text: 'fresh' }]);
});

test('finished runs accept late alternatives and steer acknowledgements while ignoring tokens', async (t) => {
  const { sockets, state } = await setup(t);
  const socket = sockets[0];
  socket.open();
  state().start('buy a car', 'qwen2.5-7b');
  socket.message({
    type: 'av', checkpoint_id: 0, position: 0, label: 'Plan',
    explanation: 'Assess the budget.', genre: '', detail: 'Assess the budget.',
    focus: 'assessing the car budget',
  });
  socket.message({ type: 'status', state: 'done' });
  const alternatives = [
    { id: 0, focus: 'weighing vehicle types', detail: 'Compare sizes and features.' },
    { id: 1, focus: 'comparing financing options', detail: 'Compare loans and leases.' },
  ];
  socket.message({
    type: 'av_alternatives', checkpoint_id: 0, position: 0, label: 'Plan', alternatives,
  });
  state().steer(0, { alternative_id: 1 });
  const runId = state().runs.at(-1).id;
  assert.deepEqual(socket.sent.at(-1), { type: 'steer', run_id: runId, checkpoint_id: 0, alternative_id: 1 });
  socket.message({
    type: 'steer_ack', run_id: runId, checkpoint_id: 0, alternative_id: 1,
    applied: false, message: 'Steering is unavailable',
  });
  socket.message({ type: 'token', index: 0, position: 0, text: 'late token' });
  const run = state().runs.at(-1);
  assert.equal(run.status, 'done');
  assert.deepEqual(run.tokens, []);
  assert.deepEqual(run.readings[0].alternatives, alternatives);
  assert.equal(run.readings[0].selectedAlternative, 1);
  assert.equal(run.readings[0].steerMessage, 'Steering is unavailable');
  assert.equal(run.readings[0].steering, false);
});

test('a branch event becomes the active run, continuing its parent up to the branch point', async (t) => {
  const { sockets, state } = await setup(t);
  const socket = sockets[0];
  socket.open();
  state().start('buy a car', 'qwen2.5-7b');
  const parentId = state().runs.at(-1).id;
  socket.message({ run_id: parentId, type: 'token', index: 0, position: 0, text: 'Intro. 1. Budget' });
  socket.message({
    run_id: parentId, type: 'av', checkpoint_id: 1, position: 7, label: 'Step 1',
    explanation: 'Budget.', genre: '', detail: 'Budget.', focus: 'setting a budget',
  });
  socket.message({ run_id: parentId, type: 'status', state: 'done' });
  state().steer(1, { text: 'credit first' });
  socket.message({ run_id: parentId, type: 'steer_ack', checkpoint_id: 1, applied: true, note: 'Checks credit.' });
  socket.message({
    type: 'branch', run_id: 'b1', parent_run_id: parentId, checkpoint_id: 1, position: 7,
    kind: 'toward', focus: 'checking credit', opening: '1. Credit', anchored: true,
  });
  socket.message({ run_id: 'b1', type: 'token', index: 0, position: 7, text: '1. Credit' });
  socket.message({ run_id: parentId, type: 'token', index: 9, position: 99, text: 'stale' });
  const branch = state().runs.at(-1);
  assert.equal(state().activeRunId, 'b1');
  assert.equal(branch.parentRunId, parentId);
  assert.equal(branch.tokens.map(token => token.text).join(''), 'Intro. 1. Credit');
  assert.deepEqual(branch.steer, {
    kind: 'toward', focus: 'checking credit', label: 'Step 1', opening: '1. Credit',
    anchored: true, note: 'Checks credit.',
  });
  // Steering the same socket kept it open, so the branch can be steered again.
  assert.equal(sockets.length, 1);
});
