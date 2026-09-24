/**
 * Test multi-file upload and form submission
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startServers } from '../server/test_server.mjs';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');
const FIXTURES_DIR = resolve('research/benchmarks/phase0.3-experiment3/fixtures');

async function testMultiAndSubmit() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9241',
    '--headless',
    '--profile', TEMP_PROFILE,
    'http://127.0.0.1:8090/upload.html'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9241/session');
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
  const ctx = treeRes.result.contexts.find(c => c.url.includes('upload.html'));
  const contextId = ctx.context;

  // 1. Locate #file-input-multi
  const multiEl = await send('script.evaluate', {
    expression: "document.getElementById('file-input-multi')",
    target: { context: contextId },
    awaitPromise: false,
    resultOwnership: 'root'
  });
  const sharedId = multiEl.result?.result?.sharedId;

  // 2. Select 5 files in order
  const filesToUpload = ['a', 'b', 'c', 'd', 'e'].map(l => resolve(FIXTURES_DIR, `upload-multi-${l}.txt`));
  console.log('Setting 5 files on #file-input-multi:');
  filesToUpload.forEach(f => console.log('  ', f));

  const setRes = await send('input.setFiles', {
    context: contextId,
    element: { sharedId },
    files: filesToUpload
  });
  console.log('setFiles result:', JSON.stringify(setRes));

  // Check DOM state
  const domCheck = await send('script.evaluate', {
    expression: `(() => {
      const el = document.getElementById('file-input-multi');
      return Array.from(el.files).map(f => ({ name: f.name, size: f.size }));
    })()`,
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('DOM files evaluated:\n', JSON.stringify(domCheck.result?.result?.value, null, 2));

  // 3. Submit form and navigate to response
  console.log('Submitting form...');
  const submitRes = await send('script.evaluate', {
    expression: "document.getElementById('submit-btn').click()",
    target: { context: contextId },
    awaitPromise: false
  });

  // Wait for submission response
  await new Promise(r => setTimeout(r, 2000));

  const responseText = await send('script.evaluate', {
    expression: "document.body.innerText",
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('Server response after form submission:\n', responseText.result?.result?.value);

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
}

testMultiAndSubmit().catch(console.error);

