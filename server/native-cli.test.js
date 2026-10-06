import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { refreshNativeLogin } from './native-cli.js';

test('Claude refresh sends only initialization and usage control requests, never a model prompt', async () => {
  const messages = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  child.stdin = new Writable({
    write(chunk, _, done) {
      const request = JSON.parse(chunk.toString());
      messages.push(request);
      queueMicrotask(() =>
        child.stdout.write(
          `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: request.request_id, response: {} } })}\n`,
        ),
      );
      done();
    },
  });
  await refreshNativeLogin(
    {
      kind: 'claude',
      binary: 'claude',
      home: '/native/.claude',
      label: 'Claude Code',
    },
    {
      spawnImpl: (_, args) => {
        assert.ok(args.includes('--no-session-persistence'));
        return child;
      },
    },
  );
  assert.deepEqual(
    messages.map((message) => message.request.subtype),
    ['initialize', 'get_usage'],
  );
  assert.ok(messages.every((message) => message.type === 'control_request'));
});

test('Codex refresh delegates to native account/read without starting a turn', async () => {
  const messages = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  child.stdin = new Writable({
    write(chunk, _, done) {
      const request = JSON.parse(chunk.toString());
      messages.push(request);
      if (request.id)
        queueMicrotask(() =>
          child.stdout.write(
            `${JSON.stringify({ id: request.id, result: {} })}\n`,
          ),
        );
      done();
    },
  });
  await refreshNativeLogin(
    {
      kind: 'codex',
      binary: 'codex',
      home: '/native/.codex',
      label: 'Codex CLI',
    },
    {
      spawnImpl: (_, args) => {
        assert.deepEqual(args, ['app-server']);
        return child;
      },
    },
  );
  assert.deepEqual(
    messages.map((message) => message.method),
    ['initialize', 'initialized', 'account/read'],
  );
  assert.deepEqual(messages.at(-1).params, { refreshToken: true });
});
