import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

let moduleId = 0;
async function setup(t, pacing) {
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
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const source = await readFile(new URL('../src/lib/stream-store.ts', import.meta.url), 'utf8');
  // Exercise the production store with only its imports resolved for Node.
  const resolved = source
    .replace('"zustand"', JSON.stringify(import.meta.resolve('zustand')))
    .replace('"@/lib/contract"', JSON.stringify(new URL('../src/lib/contract.ts', import.meta.url).href))
    .replace('"@/lib/code-points"', JSON.stringify(new URL('../src/lib/code-points.ts', import.meta.url).href));
  const { outputText } = ts.transpileModule(resolved, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const store = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}#${moduleId++}`);
  store.configurePacing({
    charsPerSecond: 0, sectionDwellMs: 0, startHoldMs: 0, startHoldMaxMs: 0, alternativesWaitMs: 0, ...pacing,
  });
  const unmount = store.mountStreamConnection();
  t.after(() => { unmount(); Object.assign(globalThis, original); });
  return { sockets, state: store.useStreamStore.getState, unmount, store };
}

test('Stop cancels a queued restart before its socket opens', async (t) => {
  const { sockets, state } = await setup(t);
  sockets[0].open();
  state().start('first', 'qwen2.5-7b');
  sockets[0].message({ type: 'status', state: 'done' });
  state().start('first', 'qwen2.5-7b');
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
  state().start('first', 'qwen2.5-7b');
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
    kind: 'toward', focus: 'checking credit', label: 'Step 1', checkpointId: 1, opening: '1. Credit',
    anchored: true, note: 'Checks credit.',
  });
  // Steering the same socket kept it open, so the branch can be steered again.
  assert.equal(sockets.length, 1);
});

function alternatives(socket, runId, checkpointId) {
  socket.message({
    run_id: runId, type: 'av_alternatives', checkpoint_id: checkpointId, position: 0, label: 'Step',
    alternatives: [{ id: 0, focus: 'going elsewhere', detail: 'Another way.' }],
  });
}

function reading(socket, runId, checkpointId, position, focus) {
  socket.message({
    run_id: runId, type: 'av', checkpoint_id: checkpointId, position, label: `Step ${checkpointId}`,
    explanation: focus, genre: '', detail: focus, focus,
  });
}

test('the reading chain keeps ancestors up to each branch point, and ancestors can be re-steered', async (t) => {
  const { sockets, state, store } = await setup(t);
  const socket = sockets[0];
  socket.open();
  state().start('buy a car', 'qwen2.5-7b');
  const parentId = state().activeRunId;
  socket.message({ run_id: parentId, type: 'token', index: 0, position: 0, text: 'Intro. 1. Budget 2. Loans' });
  reading(socket, parentId, 0, 0, 'planning');
  reading(socket, parentId, 1, 7, 'budgeting');
  reading(socket, parentId, 2, 17, 'financing');
  socket.message({ run_id: parentId, type: 'status', state: 'done' });
  state().steer(1, { away: true });
  socket.message({
    type: 'branch', run_id: 'b1', parent_run_id: parentId, checkpoint_id: 1, position: 7,
    kind: 'away', focus: 'budgeting', anchored: false,
  });
  reading(socket, 'b1', 1, 7, 'researching models');
  const chain = store.readingChain(state().runs, state().activeRunId);
  assert.deepEqual(chain.map(entry => [entry.runId, entry.reading.focus]), [
    [parentId, 'planning'], [parentId, 'budgeting'], ['b1', 'researching models'],
  ]);
  assert.equal(chain[1].forkedTo.kind, 'away');
  // Steering the parent's plan from the branch addresses the parent run.
  state().steer(0, { alternative_id: 0 }, parentId);
  assert.deepEqual(socket.sent.at(-1), { type: 'steer', run_id: parentId, checkpoint_id: 0, alternative_id: 0 });
  assert.equal(state().runs.find(run => run.id === 'b1').status, 'stopped');
});

test('inspecting holds and dropped readings are kept on the run', async (t) => {
  const { sockets, state } = await setup(t);
  const socket = sockets[0];
  socket.open();
  state().start('buy a car', 'qwen2.5-7b');
  const runId = state().activeRunId;
  socket.message({ run_id: runId, type: 'status', state: 'inspecting', checkpoint_id: 2, label: 'Step 2' });
  assert.deepEqual(state().runs.at(-1).inspecting, { checkpointId: 2, label: 'Step 2' });
  socket.message({ run_id: runId, type: 'status', state: 'streaming' });
  assert.equal(state().runs.at(-1).inspecting, undefined);
  socket.message({ run_id: runId, type: 'status', state: 'done', av_dropped: 1 });
  assert.equal(state().runs.at(-1).avDropped, 1);
});

test('a branch keeps its parent text by code points, not UTF-16 units', async (t) => {
  const { sockets, state } = await setup(t);
  const socket = sockets[0];
  socket.open();
  state().start('emoji', 'qwen2.5-7b');
  const parentId = state().activeRunId;
  socket.message({ run_id: parentId, type: 'token', index: 0, position: 0, text: '🚗🚗 cars' });
  reading(socket, parentId, 1, 2, 'cars');
  socket.message({ run_id: parentId, type: 'status', state: 'done' });
  socket.message({
    type: 'branch', run_id: 'b2', parent_run_id: parentId, checkpoint_id: 1, position: 2,
    kind: 'away', focus: 'cars', anchored: false,
  });
  assert.equal(state().runs.at(-1).tokens[0].text, '🚗🚗');
});

test('text is revealed at a reading pace and pauses where a reading\'s section starts', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 40, sectionDwellMs: 1000 });
  const socket = sockets[0];
  socket.open();
  state().start('greet', 'qwen2.5-7b');
  const runId = state().activeRunId;
  reading(socket, runId, 1, 2, 'exclaiming');
  alternatives(socket, runId, 1);
  socket.message({ run_id: runId, type: 'token', index: 0, position: 0, text: 'Hi' });
  socket.message({ run_id: runId, type: 'token', index: 1, position: 2, text: '!!' });
  socket.message({ run_id: runId, type: 'status', state: 'done' });
  const text = () => state().runs.at(-1).tokens.map(token => token.text).join('');
  assert.equal(text(), '');
  t.mock.timers.tick(50);
  assert.equal(text(), 'Hi');
  // Held before Step 1's section; the run finishes only once its text is shown.
  t.mock.timers.tick(500);
  assert.equal(text(), 'Hi');
  assert.equal(state().runs.at(-1).status, 'streaming');
  t.mock.timers.tick(600);
  assert.equal(text(), 'Hi!!');
  assert.equal(state().runs.at(-1).status, 'done');
});

test('stopping keeps the answer where it is; the rest is never shown', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 20, sectionDwellMs: 0 });
  const socket = sockets[0];
  socket.open();
  state().start('greet', 'qwen2.5-7b');
  const runId = state().activeRunId;
  socket.message({ run_id: runId, type: 'token', index: 0, position: 0, text: 'H' });
  socket.message({ run_id: runId, type: 'token', index: 1, position: 1, text: 'ello there' });
  socket.message({ run_id: runId, type: 'status', state: 'done' });
  t.mock.timers.tick(50);
  state().stop();
  for (let step = 0; step < 20; step++) t.mock.timers.tick(50);
  assert.equal(state().runs.at(-1).tokens.map(token => token.text).join(''), 'H');
  assert.equal(state().runs.at(-1).status, 'stopped');
  assert.deepEqual(sockets[0].sent.at(-1), { type: 'stop' });
});

test('pause freezes the answer and resume carries on from there', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 20, sectionDwellMs: 0 });
  const socket = sockets[0];
  socket.open();
  state().start('greet', 'qwen2.5-7b');
  const runId = state().activeRunId;
  socket.message({ run_id: runId, type: 'token', index: 0, position: 0, text: 'H' });
  socket.message({ run_id: runId, type: 'token', index: 1, position: 1, text: 'i' });
  t.mock.timers.tick(50);
  state().setPaused(true);
  for (let step = 0; step < 20; step++) t.mock.timers.tick(50);
  const text = () => state().runs.at(-1).tokens.map(token => token.text).join('');
  assert.equal(text(), 'H');
  state().setPaused(false);
  for (let step = 0; step < 4; step++) t.mock.timers.tick(50);
  assert.equal(text(), 'Hi');
});

test('a steer from past the text Stop kept hidden still continues the full answer', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 20, sectionDwellMs: 0 });
  const socket = sockets[0];
  socket.open();
  state().start('buy a car', 'qwen2.5-7b');
  const parentId = state().activeRunId;
  socket.message({ run_id: parentId, type: 'token', index: 0, position: 0, text: 'A' });
  socket.message({ run_id: parentId, type: 'token', index: 1, position: 1, text: 'BCDEFGH' });
  reading(socket, parentId, 1, 6, 'budgeting');
  socket.message({ run_id: parentId, type: 'status', state: 'done' });
  t.mock.timers.tick(50);
  state().stop();
  state().steer(1, { away: true });
  socket.message({
    type: 'branch', run_id: 'b4', parent_run_id: parentId, checkpoint_id: 1, position: 6,
    kind: 'away', focus: 'budgeting', anchored: false,
  });
  assert.equal(state().runs.at(-1).tokens[0].text, 'ABCDEF');
});

test('steering freezes the reveal instead of showing the rest of the answer, and the branch keeps the full text', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 20, sectionDwellMs: 0 });
  const socket = sockets[0];
  socket.open();
  state().start('buy a car', 'qwen2.5-7b');
  const parentId = state().activeRunId;
  socket.message({ run_id: parentId, type: 'token', index: 0, position: 0, text: 'A' });
  socket.message({ run_id: parentId, type: 'token', index: 1, position: 1, text: 'BCDEFGH' });
  reading(socket, parentId, 1, 4, 'budgeting');
  t.mock.timers.tick(50);
  const shown = () => state().runs.find(run => run.id === parentId).tokens.map(token => token.text).join('');
  assert.equal(shown(), 'A');
  state().steer(1, { away: true });
  t.mock.timers.tick(2000);
  assert.equal(shown(), 'A');
  // A refused steer lets the text carry on.
  socket.message({ run_id: parentId, type: 'steer_ack', checkpoint_id: 1, applied: false, message: 'busy' });
  for (let step = 0; step < 20; step++) t.mock.timers.tick(50);
  assert.equal(shown(), 'ABCDEFGH');
});

test('an applied steer branches from the parent\'s full text while its reveal was frozen', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 20, sectionDwellMs: 0 });
  const socket = sockets[0];
  socket.open();
  state().start('buy a car', 'qwen2.5-7b');
  const parentId = state().activeRunId;
  socket.message({ run_id: parentId, type: 'token', index: 0, position: 0, text: 'A' });
  socket.message({ run_id: parentId, type: 'token', index: 1, position: 1, text: 'BCDEFGH' });
  reading(socket, parentId, 1, 4, 'budgeting');
  t.mock.timers.tick(50);
  state().steer(1, { away: true });
  socket.message({
    type: 'branch', run_id: 'b3', parent_run_id: parentId, checkpoint_id: 1, position: 4,
    kind: 'away', focus: 'budgeting', anchored: false,
  });
  assert.equal(state().activeRunId, 'b3');
  assert.equal(state().runs.at(-1).tokens[0].text, 'ABCD');
});

test('the first words wait at least the start hold, and longer until a bubble is ready', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 1000, startHoldMs: 4000, startHoldMaxMs: 8000 });
  const socket = sockets[0];
  socket.open();
  state().start('plan', 'qwen2.5-7b');
  const runId = state().activeRunId;
  socket.message({ run_id: runId, type: 'token', index: 0, position: 0, text: 'Hello' });
  const text = () => state().runs.at(-1).tokens.map(token => token.text).join('');
  for (let step = 0; step < 90; step++) t.mock.timers.tick(50); // 4.5 s, no bubble yet
  assert.equal(text(), '');
  reading(socket, runId, 0, 0, 'planning');
  alternatives(socket, runId, 0);
  for (let step = 0; step < 2; step++) t.mock.timers.tick(50);
  assert.equal(text(), 'Hello');
});

test('without any bubble the first words still come after the longest hold', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 1000, startHoldMs: 4000, startHoldMaxMs: 8000 });
  const socket = sockets[0];
  socket.open();
  state().start('plan', 'qwen2.5-7b');
  const runId = state().activeRunId;
  socket.message({ run_id: runId, type: 'token', index: 0, position: 0, text: 'Hello' });
  const text = () => state().runs.at(-1).tokens.map(token => token.text).join('');
  for (let step = 0; step < 150; step++) t.mock.timers.tick(50);
  assert.equal(text(), '');
  for (let step = 0; step < 12; step++) t.mock.timers.tick(50);
  assert.equal(text(), 'Hello');
});

test('the text waits at a section for its bubble, then goes on without it after a while', async (t) => {
  const { sockets, state } = await setup(t, { charsPerSecond: 1000, alternativesWaitMs: 2000 });
  const socket = sockets[0];
  socket.open();
  state().start('greet', 'qwen2.5-7b');
  const runId = state().activeRunId;
  reading(socket, runId, 1, 2, 'exclaiming');
  socket.message({ run_id: runId, type: 'token', index: 0, position: 0, text: 'Hi' });
  socket.message({ run_id: runId, type: 'token', index: 1, position: 2, text: '!!' });
  const text = () => state().runs.at(-1).tokens.map(token => token.text).join('');
  for (let step = 0; step < 20; step++) t.mock.timers.tick(50);
  assert.equal(text(), 'Hi');
  for (let step = 0; step < 30; step++) t.mock.timers.tick(50);
  assert.equal(text(), 'Hi!!');
});
