import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { startServers } from '../server/test_server.mjs';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');
const DOWNLOAD_DIR = resolve('research/benchmarks/phase0.3-experiment3/downloads');

async function testCollisionAndDenied() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9244',
    '--headless',
    '--profile', TEMP_PROFILE,
    'about:blank'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9244/session');
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
      }, 15000);

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
  const contextId = treeRes.result.contexts[0].context;

  await send('browsingContext.navigate', {
    context: contextId,
    url: 'http://127.0.0.1:8090/download_page.html',
    wait: 'complete'
  });

  // 1. Test Collision
  console.log('--- 1. Testing Filename Collision ---');
  await send('browser.setDownloadBehavior', {
    downloadBehavior: {
      type: 'allowed',
      destinationFolder: DOWNLOAD_DIR
    }
  });

  console.log('Files before duplicate click:', readdirSync(DOWNLOAD_DIR));
  await send('script.evaluate', {
    expression: "document.getElementById('link-direct-1mb').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  await new Promise(r => setTimeout(r, 2000));
  console.log('Files after duplicate click (collision):', readdirSync(DOWNLOAD_DIR));

  // 2. Test Denied
  console.log('\n--- 2. Testing type: "denied" ---');
  const setDeniedRes = await send('browser.setDownloadBehavior', {
    downloadBehavior: { type: 'denied' }
  });
  console.log('setDownloadBehavior denied res:', JSON.stringify(setDeniedRes));

  const countBeforeDenied = readdirSync(DOWNLOAD_DIR).length;
  await send('script.evaluate', {
    expression: "document.getElementById('btn-data-download').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  await new Promise(r => setTimeout(r, 2000));
  const countAfterDenied = readdirSync(DOWNLOAD_DIR).length;
  console.log(`Files count before: ${countBeforeDenied}, after denied click: ${countAfterDenied}`);

  // 3. Test Non-existent destinationFolder
  console.log('\n--- 3. Testing Non-existent destinationFolder ---');
  const nonexistentDir = resolve(DOWNLOAD_DIR, 'nested_nonexistent_dir_9999');
  const setNonexistRes = await send('browser.setDownloadBehavior', {
    downloadBehavior: {
      type: 'allowed',
      destinationFolder: nonexistentDir
    }
  });
  console.log('setDownloadBehavior nonexistent res:', JSON.stringify(setNonexistRes));

  await send('script.evaluate', {
    expression: "document.getElementById('link-direct-text').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  await new Promise(r => setTimeout(r, 2000));
  console.log('Does nonexistentDir exist after download?', existsSync(nonexistentDir));
  if (existsSync(nonexistentDir)) {
    console.log('Contents of nonexistentDir:', readdirSync(nonexistentDir));
  }

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
}

testCollisionAndDenied().catch(console.error);

