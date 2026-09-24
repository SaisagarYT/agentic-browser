/**
 * Probe edge cases: hidden input, disabled input, nonexistent file path
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startServers } from '../server/test_server.mjs';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');
const FIXTURES_DIR = resolve('research/benchmarks/phase0.3-experiment3/fixtures');

async function testEdgeCases() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9239',
    '--headless',
    '--profile', TEMP_PROFILE,
    'http://127.0.0.1:8090/upload.html'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9239/session');
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
  const ctx = treeRes.result.contexts.find(c => c.url.includes('upload.html')) || treeRes.result.contexts[0];
  const contextId = ctx.context;

  const testFile = resolve(FIXTURES_DIR, 'upload-small.txt');
  const nonexistentFile = 'C:\\agentic-browser-nonexistent-path\\test-file.bin';

  // 1. Hidden input
  console.log('\n--- 1. Testing Hidden Input (#file-input-hidden) ---');
  const hiddenEl = await send('script.evaluate', {
    expression: "document.getElementById('file-input-hidden')",
    target: { context: contextId },
    awaitPromise: false,
    resultOwnership: 'root'
  });
  const hiddenRes = await send('input.setFiles', {
    context: contextId,
    element: { sharedId: hiddenEl.result?.result?.sharedId },
    files: [testFile]
  });
  console.log('Hidden input setFiles result:', JSON.stringify(hiddenRes));
  const hiddenStatus = await send('script.evaluate', {
    expression: "document.getElementById('file-input-hidden').files.length",
    target: { context: contextId }
  });
  console.log('Hidden input files count:', hiddenStatus.result?.result?.value);

  // 2. Disabled input
  console.log('\n--- 2. Testing Disabled Input (#file-input-disabled) ---');
  const disabledEl = await send('script.evaluate', {
    expression: "document.getElementById('file-input-disabled')",
    target: { context: contextId },
    awaitPromise: false,
    resultOwnership: 'root'
  });
  const disabledRes = await send('input.setFiles', {
    context: contextId,
    element: { sharedId: disabledEl.result?.result?.sharedId },
    files: [testFile]
  });
  console.log('Disabled input setFiles result:', JSON.stringify(disabledRes));
  const disabledStatus = await send('script.evaluate', {
    expression: "document.getElementById('file-input-disabled').files.length",
    target: { context: contextId }
  });
  console.log('Disabled input files count:', disabledStatus.result?.result?.value);

  // 3. Nonexistent file
  console.log('\n--- 3. Testing Nonexistent File ---');
  const visibleEl = await send('script.evaluate', {
    expression: "document.getElementById('file-input-visible')",
    target: { context: contextId },
    awaitPromise: false,
    resultOwnership: 'root'
  });
  const nonexistRes = await send('input.setFiles', {
    context: contextId,
    element: { sharedId: visibleEl.result?.result?.sharedId },
    files: [nonexistentFile]
  });
  console.log('Nonexistent file setFiles result:', JSON.stringify(nonexistRes));

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
}

testEdgeCases().catch(console.error);

