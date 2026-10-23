import 'dotenv/config';
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import { once } from 'node:events';
import { resolve, join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

const targetUrl = process.env.TEST_DATABASE_URL;
const runtimeRoot = resolve(process.env.QA_RUNTIME_ROOT || '.');
let child, proxy, base, directory, output = '';
let runtimeEnv;
const sockets = new Set();

describe('Compiled production lifecycle and database health', { skip: !targetUrl }, () => {
  before(async () => {
    const target = new URL(targetUrl);
    const name = decodeURIComponent(target.pathname.slice(1));
    assert.match(name, /^[a-zA-Z0-9_]+_test$/);
    assert.notEqual(name, process.env.DATABASE_URL ? decodeURIComponent(new URL(process.env.DATABASE_URL).pathname.slice(1)) : '');
    directory = await mkdtemp(join(tmpdir(), 'task-tracker-runtime-'));
    proxy = createServer((client) => {
      const upstream = createConnection({ host: target.hostname, port: Number(target.port || 5432) });
      for (const socket of [client, upstream]) {
        sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => { client.destroy(); upstream.destroy(); });
      }
      client.pipe(upstream); upstream.pipe(client);
    });
    proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
    const proxyUrl = new URL(target); proxyUrl.hostname = '127.0.0.1'; proxyUrl.port = String(proxy.address().port);
    const portServer = createServer(); portServer.listen(0, '127.0.0.1'); await once(portServer, 'listening');
    const port = portServer.address().port; await new Promise((resolve) => portServer.close(resolve));
    base = `http://127.0.0.1:${port}`;
    runtimeEnv = { ...process.env, DATABASE_URL: proxyUrl.toString(), PORT: String(port), NODE_ENV: 'production',
      JWT_SECRET: randomBytes(32).toString('hex'), JWT_ISSUER: 'runtime-qa', JWT_AUDIENCE: 'runtime-client', UPLOAD_DIR: directory };
    // Native JavaScript only. IPC invokes the actual SIGTERM handler on Windows,
    // where child.kill(SIGTERM) terminates the process instead of delivering it.
    const moduleUrl = pathToFileURL(join(runtimeRoot, 'dist/server.js')).href;
    const harness = `process.on('message', m => { if(m==='shutdown'){process.disconnect();process.emit('SIGTERM');} }); await import(${JSON.stringify(moduleUrl)});`;
    child = spawn(process.execPath, ['--input-type=module', '-e', harness], {
      cwd: runtimeRoot, env: runtimeEnv, stdio: ['ignore','pipe','pipe','ipc'],
    });
    child.stdout.on('data', (data) => { output += data; }); child.stderr.on('data', (data) => { output += data; });
    let ready = false;
    for (let attempt=0;attempt<100;attempt++) {
      try { const response = await fetch(`${base}/api/health`); if(response.status===200){ready=true;break;} } catch {}
      if(child.exitCode!==null) break;
      await new Promise((resolve) => setTimeout(resolve,100));
    }
    assert.equal(ready,true,'Compiled server must start and connect to the isolated test database');
  });
  after(async () => {
    if(child && child.exitCode===null){child.kill();await once(child,'exit').catch(()=>{});}
    for(const socket of sockets)socket.destroy();
    if(proxy?.listening)await new Promise((resolve)=>proxy.close(resolve));
    if(directory){assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}
  });
  test('compiled entry responds with database-connected health and safe headers', async () => {
    const response=await fetch(`${base}/api/health`);assert.equal(response.status,200);
    const body=await response.json();assert.equal(body.status,'ok');assert.equal(body.database,'connected');
    assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(JSON.stringify(body).includes(runtimeEnv.DATABASE_URL),false);
  });
  test('invalid environment fails startup without leaking configured values', () => {
    const result=spawnSync(process.execPath,['dist/server.js'],{cwd:runtimeRoot,env:{...runtimeEnv,JWT_SECRET:''},encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Invalid environment configuration: JWT_SECRET/);
    assert.equal(result.stderr.includes(runtimeEnv.DATABASE_URL),false);
  });
  test('compiled cleanup command runs without a TypeScript runner', () => {
    const result=spawnSync(process.execPath,['dist/services/storage/cleanup-command.js'],{cwd:runtimeRoot,env:{...runtimeEnv,DATABASE_URL:targetUrl},encoding:'utf8',timeout:30000});
    assert.equal(result.status,0,'Compiled cleanup command must run');assert.match(result.stdout,/"failed":0/);
  });
  test('actual loss of the test database proxy produces credential-free HTTP 503', async () => {
    for(const socket of sockets)socket.destroy();await new Promise((resolve)=>proxy.close(resolve));
    const response=await fetch(`${base}/api/health`);assert.equal(response.status,503);
    const body=await response.json();assert.equal(body.status,'unavailable');assert.equal(body.database,'disconnected');
    assert.equal(JSON.stringify(body).includes(runtimeEnv.DATABASE_URL),false);
  });
  test('SIGTERM handler closes HTTP/database resources and exits successfully', async () => {
    const exit=once(child,'exit');child.send('shutdown');const [code]=await exit;
    assert.equal(code,0);assert.equal(output.includes(runtimeEnv.DATABASE_URL),false);
    await assert.rejects(fetch(`${base}/api/health`));
  });
});
