import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  realpath,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createGitHubBridge } from './github.js';

async function fixture(t) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'accountdeck-github-test-')),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  await mkdir(bin);
  await writeFile(
    join(bin, 'gh'),
    `#!${process.execPath}\nconst secrets = ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN','GH_DEBUG','DEBUG'];
if (secrets.some(key => process.env[key])) process.exit(2);
if (process.argv.slice(2).join(' ') !== 'auth status --json hosts') process.exit(3);
console.log(JSON.stringify({hosts:{'github.com':[{login:'alice',state:'success',active:true,tokenSource:'keyring',token:'never-return-token'},{login:'bob',state:'success',active:false,tokenSource:'keyring'}]}}));\n`,
    { mode: 0o700 },
  );
  const config = join(root, 'config', 'config.json');
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GHR_CONFIG: config,
    GH_TOKEN: 'ambient-secret',
    GITHUB_TOKEN: 'ambient-secret',
    GH_DEBUG: 'api',
    DEBUG: '1',
  };
  const bridge = createGitHubBridge({ env });
  return { root, config, bridge, env };
}
const state = (bridge, machine = 'local') =>
  bridge({ endpoint: 'state', method: 'GET', machine });
const mapping = (bridge, method, body, machine = 'local') =>
  bridge({ endpoint: 'mappings', method, body, machine });
function git(path, ...args) {
  return execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

test('GitHub bridge reuses private route storage, strips credentials, and preserves scoped routes', async (t) => {
  const { root, config, bridge } = await fixture(t);
  const workspace = join(root, 'projects');
  const checkout = join(workspace, 'repository with spaces');
  await mkdir(checkout, { recursive: true });
  git(checkout, 'init', '-q');
  git(
    checkout,
    'remote',
    'add',
    'origin',
    'https://username:remote-secret@github.com/alice/project.git',
  );
  git(
    checkout,
    'remote',
    'add',
    'upstream',
    'https://github.com/bob/project.git',
  );
  const initial = await state(bridge);
  assert.deepEqual(
    initial.accounts.map((a) => a.account),
    ['alice', 'bob'],
  );
  assert.equal(JSON.stringify(initial).includes('never-return-token'), false);
  assert.equal(JSON.stringify(initial).includes('ambient-secret'), false);
  assert.deepEqual(initial.mappings, []);
  await mapping(bridge, 'PUT', {
    path: workspace,
    host: 'github.com',
    account: 'alice',
  });
  await mapping(bridge, 'PUT', {
    path: checkout,
    host: 'github.com',
    account: 'bob',
    repo: 'bob/project',
  });
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  assert.equal((await state(bridge)).mappings.length, 2);
  const scanned = await bridge({
    endpoint: 'scan',
    method: 'GET',
    path: workspace,
  });
  assert.equal(scanned.repositories.length, 1);
  const remotes = scanned.repositories[0].remotes;
  assert.equal(remotes.find((r) => r.repo === 'alice/project').account, null);
  assert.equal(remotes.find((r) => r.repo === 'bob/project').account, 'bob');
  assert.equal(JSON.stringify(scanned).includes('remote-secret'), false);
  // Scoped checkout routes require each remote to be assigned explicitly.
  await mapping(bridge, 'PUT', {
    path: checkout,
    host: 'github.com',
    account: 'alice',
    repo: 'alice/project',
  });
  const assigned = await bridge({
    endpoint: 'scan',
    method: 'GET',
    path: workspace,
  });
  assert.equal(
    assigned.repositories[0].remotes.find((r) => r.repo === 'alice/project')
      .account,
    'alice',
  );
  await mapping(bridge, 'DELETE', {
    path: checkout,
    host: 'github.com',
    repo: 'alice/project',
  });
  await assert.rejects(
    mapping(bridge, 'PUT', {
      path: checkout,
      host: 'github.com',
      account: 'missing',
    }),
    /not signed in/,
  );
  await assert.rejects(
    mapping(bridge, 'PUT', {
      path: checkout,
      host: 'github.com',
      account: 'bob',
      repo: 'other/project',
    }),
    /does not match a remote/,
  );
  await mapping(bridge, 'DELETE', {
    path: checkout,
    host: 'github.com',
    repo: 'bob/project',
  });
  assert.deepEqual((await state(bridge)).mappings, [
    { path: workspace, host: 'github.com', account: 'alice' },
  ]);
  await assert.rejects(
    bridge({
      endpoint: 'exec',
      method: 'POST',
      command: 'touch /tmp/forbidden',
    }),
    /Unknown GitHub workspace/,
  );
  await assert.rejects(
    bridge({
      endpoint: 'scan',
      method: 'GET',
      path: `${workspace}; touch ${root}/injected`,
    }),
    /does not exist/,
  );
  await assert.rejects(stat(join(root, 'injected')), { code: 'ENOENT' });
});

test('paired metadata and mutations stay on the selected computer, without exposing pairing keys', async (t) => {
  const { root, config, bridge } = await fixture(t);
  const session = 'a'.repeat(43);
  const calls = [];
  let rejected = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({
      path: req.url,
      method: req.method,
      auth: req.headers.authorization,
      body: body ? JSON.parse(body) : null,
    });
    res.setHeader('Content-Type', 'application/json');
    if (rejected) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: session }));
      return;
    }
    if (req.url.startsWith('/api/state'))
      res.end(
        JSON.stringify({
          accounts: [
            {
              host: 'github.com',
              account: 'remote',
              state: 'success',
              token: 'remote-token',
            },
          ],
          mappings: [
            {
              path: '/remote/project',
              host: 'github.com',
              account: 'remote',
              secret: 'route-secret',
            },
          ],
          home: '/remote',
          config: '/remote/config',
          machine: { hostname: 'work-mac', session },
          version: '0.3.0',
          access_token: 'state-secret',
        }),
      );
    else if (req.url.startsWith('/api/scan'))
      res.end(
        JSON.stringify({
          repositories: [
            {
              path: '/remote/project',
              remotes: [
                {
                  host: 'github.com',
                  repo: 'remote/project',
                  protocol: 'https',
                  url: 'https://secret@github.com/remote/project',
                },
              ],
              secret: 'scan-secret',
            },
          ],
        }),
      );
    else
      res.end(
        JSON.stringify({
          ...JSON.parse(body),
          access_token: 'mutation-secret',
        }),
      );
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await bridge({
    endpoint: 'machines',
    method: 'PUT',
    body: { name: 'work-mac', url: `${origin}/#${session}` },
  });
  assert.equal(
    (await stat(join(root, 'config', 'machines.json'))).mode & 0o777,
    0o600,
  );
  const registry = await bridge({ endpoint: 'machines', method: 'GET' });
  assert.deepEqual(registry, { machines: [{ name: 'work-mac', url: origin }] });
  const remote = await state(bridge, 'work-mac');
  assert.equal(remote.accounts[0].account, 'remote');
  assert.equal(remote.machine.hostname, 'work-mac');
  assert.equal(JSON.stringify(remote).includes('secret'), false);
  assert.equal(JSON.stringify(remote).includes(session), false);
  const body = {
    path: '/remote/project',
    host: 'github.com',
    account: 'remote',
    repo: 'remote/project',
    token: 'not-forwarded',
  };
  const response = await mapping(bridge, 'PUT', body, 'work-mac');
  assert.equal(response.account, 'remote');
  assert.equal(JSON.stringify(response).includes('secret'), false);
  assert.equal(calls.at(-1).body.token, undefined);
  assert.equal(calls.at(-1).auth, `Bearer ${session}`);
  const scan = await bridge({
    endpoint: 'scan',
    method: 'GET',
    machine: 'work-mac',
    path: '/remote/projects with spaces',
  });
  assert.equal(scan.repositories[0].remotes[0].url, undefined);
  assert.match(calls.at(-1).path, /path=%2Fremote%2Fprojects\+with\+spaces/);
  await assert.rejects(readFile(config), { code: 'ENOENT' }); // Remote writes never create a local route.
  rejected = true;
  await assert.rejects(
    state(bridge, 'work-mac'),
    (error) =>
      /rejected the session/.test(error.message) &&
      !error.message.includes(session),
  );
  await assert.rejects(
    bridge({
      endpoint: 'machines',
      method: 'PUT',
      body: { name: 'bad', url: `${origin}/#${session}` },
    }),
    /rejected the session/,
  );
  assert.equal(
    (await bridge({ endpoint: 'machines', method: 'GET' })).machines.length,
    1,
  );
  await bridge({
    endpoint: 'machines',
    method: 'DELETE',
    body: { name: 'work-mac' },
  });
  assert.deepEqual(await bridge({ endpoint: 'machines', method: 'GET' }), {
    machines: [],
  });
});

test('bridge bounds requests and subprocess time without relaying stderr', async (t) => {
  const { root, env } = await fixture(t);
  const python = join(root, 'slow-python');
  await writeFile(
    python,
    '#!/bin/sh\nprintf "secret-debug-data" >&2\nsleep 30\n',
    { mode: 0o700 },
  );
  const bridge = createGitHubBridge({ python, env, timeoutMs: 100 });
  await assert.rejects(
    state(bridge),
    (error) =>
      /timed out/.test(error.message) &&
      !error.message.includes('secret-debug-data'),
  );
  await assert.rejects(
    bridge({ endpoint: 'scan', path: 'x'.repeat(9000) }),
    /too large/,
  );
  await assert.rejects(
    createGitHubBridge({ python: join(root, 'missing'), env })({
      endpoint: 'state',
    }),
    /Could not start GitHub routing/,
  );
});
