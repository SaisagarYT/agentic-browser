/**
 * Probe all download mechanisms: large files, blob, data URL, collisions, denied behavior, failures
 */

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

async function testAllDownloads() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9242',
    '--headless',
    '--profile', TEMP_PROFILE,
    'http://127.0.0.1:8090/download_page.html'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9242/session');
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
  await send('session.subscribe', { events: ['network.beforeRequestSent', 'network.responseCompleted', 'network.fetchError'] });

  const treeRes = await send('browsingContext.getTree', {});
  const ctx = treeRes.result.contexts.find(c => c.url.includes('download_page.html'));
  const contextId = ctx.context;

  // Set download behavior
  await send('browser.setDownloadBehavior', {
    downloadBehavior: {
      type: 'allowed',
      destinationFolder: DOWNLOAD_DIR
    }
  });

  // 1. Download 1MB
  console.log('\n--- 1. Download 1MB ---');
  let t0 = Date.now();
  await send('script.evaluate', {
    expression: "document.getElementById('link-direct-1mb').click()",
    target: { context: contextId }
  });
  await new Promise(r => setTimeout(r, 2000));
  let files = readdirSync(DOWNLOAD_DIR);
  console.log('Download dir after 1MB:', files);
  let file1mb = files.find(f => f.includes('1mb'));
  if (file1mb) {
    const p = resolve(DOWNLOAD_DIR, file1mb);
    const sz = statSync(p).size;
    const h = createHash('sha256').update(readFileSync(p)).digest('hex');
    console.log(`  File: ${file1mb}, Size: ${sz}, Hash: ${h.slice(0, 16)}... (Expected: ${CHECKSUMS.oneMb.slice(0, 16)}...), Match: ${h === CHECKSUMS.oneMb}`);
  }

  // 2. Download 10MB
  console.log('\n--- 2. Download 10MB ---');
  t0 = Date.now();
  await send('script.evaluate', {
    expression: "document.getElementById('link-direct-10mb').click()",
    target: { context: contextId }
  });
  await new Promise(r => setTimeout(r, 4000));
  files = readdirSync(DOWNLOAD_DIR);
  console.log('Download dir after 10MB:', files);
  let file10mb = files.find(f => f.includes('10mb') && !f.endsWith('.part'));
  if (file10mb) {
    const p = resolve(DOWNLOAD_DIR, file10mb);
    const sz = statSync(p).size;
    const h = createHash('sha256').update(readFileSync(p)).digest('hex');
    console.log(`  File: ${file10mb}, Size: ${sz}, Hash: ${h.slice(0, 16)}... (Expected: ${CHECKSUMS.tenMb.slice(0, 16)}...), Match: ${h === CHECKSUMS.tenMb}`);
  }

  // 3. Blob Download
  console.log('\n--- 3. Blob URL Download ---');
  await send('script.evaluate', {
    expression: "document.getElementById('btn-blob-download').click()",
    target: { context: contextId }
  });
  await new Promise(r => setTimeout(r, 1500));
  files = readdirSync(DOWNLOAD_DIR);
  console.log('Download dir after Blob:', files);

  // 4. Data URL Download
  console.log('\n--- 4. Data URL Download ---');
  await send('script.evaluate', {
    expression: "document.getElementById('btn-data-download').click()",
    target: { context: contextId }
  });
  await new Promise(r => setTimeout(r, 1500));
  files = readdirSync(DOWNLOAD_DIR);
  console.log('Download dir after Data URL:', files);

  // 5. Filename Collision (download direct-text twice)
  console.log('\n--- 5. Filename Collision Test ---');
  await send('script.evaluate', {
    expression: "document.getElementById('link-direct-text').click()",
    target: { context: contextId }
  });
  await new Promise(r => setTimeout(r, 1000));
  await send('script.evaluate', {
    expression: "document.getElementById('link-direct-text').click()",
    target: { context: contextId }
  });
  await new Promise(r => setTimeout(r, 1500));
  files = readdirSync(DOWNLOAD_DIR);
  console.log('Download dir after collision:', files);

  // 6. Denied Behavior Test
  console.log('\n--- 6. Testing type: "denied" ---');
  await send('browser.setDownloadBehavior', {
    downloadBehavior: { type: 'denied' }
  });
  const beforeDeniedCount = readdirSync(DOWNLOAD_DIR).length;
  await send('script.evaluate', {
    expression: "document.getElementById('link-direct-text').click()",
    target: { context: contextId }
  });
  await new Promise(r => setTimeout(r, 1500));
  const afterDeniedCount = readdirSync(DOWNLOAD_DIR).length;
  console.log(`Files count before: ${beforeDeniedCount}, after denied click: ${afterDeniedCount}, New files: ${afterDeniedCount - beforeDeniedCount}`);

  // 7. Download Failures (404 and Abort)
  console.log('\n--- 7. Download Failure Cases ---');
  const nav404 = await send('browsingContext.navigate', {
    context: contextId,
    url: 'http://127.0.0.1:8090/download/404'
  });
  console.log('Navigate 404 res:', JSON.stringify(nav404));

  const navAbort = await send('browsingContext.navigate', {
    context: contextId,
    url: 'http://127.0.0.1:8090/download/abort'
  });
  console.log('Navigate Abort res:', JSON.stringify(navAbort));

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
}

testAllDownloads().catch(console.error);

