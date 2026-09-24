/**
 * Deep Probe on input.setFiles and browser.setDownloadBehavior
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { rmSync, mkdirSync, existsSync } from 'node:fs';
import { startServers } from '../server/test_server.mjs';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');
const FIXTURES_DIR = resolve('research/benchmarks/phase0.3-experiment3/fixtures');

async function runDeepProbe() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9236',
    '--headless',
    '--profile', TEMP_PROFILE,
    'http://127.0.0.1:8090/upload.html'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9236/session');
      await new Promise((res, rej) => {
        testWs.onopen = () => { ws = testWs; res(); };
        testWs.onerror = rej;
      });
      if (ws) break;
    } catch (e) {}
  }

  let msgId = 1;
  function send(method, params = {}) {
    return new Promise((res) => {
      const id = msgId++;
      const timer = setTimeout(() => {
        ws.removeEventListener('message', handler);
        res({ id, error: 'timeout', message: 'Timeout' });
      }, 8000);

      const handler = (evt) => {
        try {
          const d = JSON.parse(evt.data);
          if (d.id === id) {
            clearTimeout(timer);
            ws.removeEventListener('message', handler);
            res(d);
          }
        } catch (e) {}
      };
      ws.addEventListener('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  await send('session.new', { capabilities: {} });

  const treeRes = await send('browsingContext.getTree', {});
  // Find context for upload.html
  const uploadContext = treeRes.result.contexts.find(c => c.url.includes('upload.html')) || treeRes.result.contexts[0];
  const contextId = uploadContext.context;
  console.log('Upload Page Context:', contextId, uploadContext.url);

  // 1. Locate file-input-visible
  const evalRes = await send('script.evaluate', {
    expression: "document.getElementById('file-input-visible')",
    target: { context: contextId },
    awaitPromise: false,
    resultOwnership: 'root'
  });
  console.log('Element Shared ID:', evalRes.result?.result?.sharedId);
  const sharedId = evalRes.result?.result?.sharedId;

  // 2. Test input.setFiles with sharedId
  const testFile = resolve(FIXTURES_DIR, 'upload-small.txt');
  const setFilesRes = await send('input.setFiles', {
    context: contextId,
    element: { sharedId },
    files: [testFile]
  });
  console.log('input.setFiles with valid sharedId:', JSON.stringify(setFilesRes));

  // 3. Check client status in DOM
  const statusRes = await send('script.evaluate', {
    expression: "document.getElementById('file-status').innerText",
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('DOM File Status after setFiles:\n', statusRes.result?.result?.value);

  // 4. Test browser.setDownloadBehavior parameters
  console.log('\n--- Probing browser.setDownloadBehavior options ---');
  const downloadBehaviorProbes = [
    { downloadBehavior: {} },
    { downloadBehavior: { behavior: 'allow' } },
    { downloadBehavior: { behavior: 'allow', destination: 'C:\\temp' } },
    { downloadBehavior: { behavior: 'allow', downloadPath: 'C:\\temp' } },
    { downloadBehavior: { type: 'allow' } },
    { downloadBehavior: null }
  ];

  for (const p of downloadBehaviorProbes) {
    const res = await send('browser.setDownloadBehavior', p);
    console.log(`Probe [${JSON.stringify(p)}]:`, JSON.stringify(res));
  }

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
  console.log('\nDeep probe completed.');
}

runDeepProbe().catch(console.error);

