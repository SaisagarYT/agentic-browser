import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readdirSync, rmSync, mkdirSync, statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { startServers, CHECKSUMS } from '../server/test_server.mjs';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');
const DOWNLOAD_DIR = resolve('research/benchmarks/phase0.3-experiment3/downloads');

if (existsSync(DOWNLOAD_DIR)) {
  rmSync(DOWNLOAD_DIR, { recursive: true, force: true });
}
mkdirSync(DOWNLOAD_DIR, { recursive: true });

async function verifyDl() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9243',
    '--headless',
    '--profile', TEMP_PROFILE,
    'about:blank'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9243/session');
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

  // Navigate explicitly and await completion
  console.log('Navigating to download_page.html...');
  const navRes = await send('browsingContext.navigate', {
    context: contextId,
    url: 'http://127.0.0.1:8090/download_page.html',
    wait: 'complete'
  });
  console.log('Navigation res:', JSON.stringify(navRes));

  // Set download behavior
  console.log('Setting downloadBehavior destinationFolder to:', DOWNLOAD_DIR);
  await send('browser.setDownloadBehavior', {
    downloadBehavior: {
      type: 'allowed',
      destinationFolder: DOWNLOAD_DIR
    }
  });

  // Test 1MB
  console.log('Clicking #link-direct-1mb...');
  const click1mb = await send('script.evaluate', {
    expression: "document.getElementById('link-direct-1mb').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('Click 1mb res:', JSON.stringify(click1mb));
  await new Promise(r => setTimeout(r, 2000));
  console.log('Files after 1MB:', readdirSync(DOWNLOAD_DIR));

  // Test 10MB
  console.log('Clicking #link-direct-10mb...');
  const click10mb = await send('script.evaluate', {
    expression: "document.getElementById('link-direct-10mb').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('Click 10mb res:', JSON.stringify(click10mb));
  await new Promise(r => setTimeout(r, 4000));
  console.log('Files after 10MB:', readdirSync(DOWNLOAD_DIR));

  // Test Blob
  console.log('Clicking #btn-blob-download...');
  const clickBlob = await send('script.evaluate', {
    expression: "document.getElementById('btn-blob-download').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('Click blob res:', JSON.stringify(clickBlob));
  await new Promise(r => setTimeout(r, 1500));
  console.log('Files after Blob:', readdirSync(DOWNLOAD_DIR));

  // Test Data URI
  console.log('Clicking #btn-data-download...');
  const clickData = await send('script.evaluate', {
    expression: "document.getElementById('btn-data-download').click()",
    target: { context: contextId },
    awaitPromise: false
  });
  console.log('Click data res:', JSON.stringify(clickData));
  await new Promise(r => setTimeout(r, 1500));
  console.log('Files after Data URI:', readdirSync(DOWNLOAD_DIR));

  // Verify file sizes and hashes
  console.log('\n--- Final Downloaded Files Summary ---');
  for (const f of readdirSync(DOWNLOAD_DIR)) {
    const p = resolve(DOWNLOAD_DIR, f);
    const sz = statSync(p).size;
    const h = createHash('sha256').update(readFileSync(p)).digest('hex');
    console.log(`  File: ${f.padEnd(24)} | Size: ${String(sz).padStart(10)} bytes | SHA256: ${h.slice(0, 16)}...`);
  }

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
}

verifyDl().catch(console.error);
