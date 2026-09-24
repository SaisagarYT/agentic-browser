/**
 * Test where files actually get downloaded when browser.setDownloadBehavior is set
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { startServers } from '../server/test_server.mjs';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');
const DOWNLOAD_DIR = resolve('research/benchmarks/phase0.3-experiment3/downloads');

if (existsSync(DOWNLOAD_DIR)) {
  rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
}
mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function testDownloadPath() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9238',
    '--headless',
    '--profile', TEMP_PROFILE,
    'http://127.0.0.1:8090/download_page.html'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9238/session');
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
  await send('session.subscribe', { events: ['network.beforeRequestSent', 'network.responseCompleted'] });

  const treeRes = await send('browsingContext.getTree', {});
  const ctx = treeRes.result.contexts.find(c => c.url.includes('download_page.html')) || treeRes.result.contexts[0];
  const contextId = ctx.context;

  // Set download behavior
  console.log('Setting downloadBehavior destinationFolder to:', DOWNLOAD_DIR);
  const setDlRes = await send('browser.setDownloadBehavior', {
    downloadBehavior: {
      type: 'allowed',
      destinationFolder: DOWNLOAD_DIR
    }
  });
  console.log('setDownloadBehavior res:', JSON.stringify(setDlRes));

  // Listen for network events
  const networkEvents = [];
  ws.addEventListener('message', (evt) => {
    try {
      const d = JSON.parse(evt.data);
      if (d.method && d.method.startsWith('network.')) {
        networkEvents.push(d);
      }
    } catch (e) {}
  });

  // Click direct text download link
  console.log('Clicking #link-direct-text...');
  const clickRes = await send('script.evaluate', {
    expression: "document.getElementById('link-direct-text').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('Click res:', JSON.stringify(clickRes));

  // Wait 3 seconds
  await new Promise(r => setTimeout(r, 3000));

  console.log('Network events captured:', networkEvents.length);
  for (const n of networkEvents) {
    console.log(`  Event: ${n.method} -> ${n.params?.request?.url}`);
  }

  // Check downloads dir
  console.log('Files in DOWNLOAD_DIR:', readdirSync(DOWNLOAD_DIR));

  // Check user Downloads folder
  const userDownloads = resolve(process.env.USERPROFILE, 'Downloads');
  console.log('Checking recent files in user Downloads:', readdirSync(userDownloads).filter(f => f.includes('download-text') || f.includes('direct-text')));

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
}

testDownloadPath().catch(console.error);
