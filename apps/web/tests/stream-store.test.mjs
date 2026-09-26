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
