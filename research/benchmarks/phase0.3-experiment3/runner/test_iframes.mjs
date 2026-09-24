/**
 * Probe Same-Origin and Cross-Origin Iframe File Uploads
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { startServers } from '../server/test_server.mjs';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');
const FIXTURES_DIR = resolve('research/benchmarks/phase0.3-experiment3/fixtures');

async function testIframeUploads() {
  const { server1, server2 } = await startServers(8090, 8091);
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9240',
    '--headless',
    '--profile', TEMP_PROFILE,
    'http://127.0.0.1:8090/iframe_host.html'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9240/session');
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
  // Wait for iframes to load
  await new Promise(r => setTimeout(r, 1000));

  const treeRes = await send('browsingContext.getTree', {});
  console.log('Tree Structure:');
  const hostCtx = treeRes.result.contexts.find(c => c.url.includes('iframe_host.html'));
  console.log('Host Context:', hostCtx?.context, hostCtx?.url);
  console.log('Host Children Count:', hostCtx?.children?.length);
  for (const child of hostCtx?.children || []) {
    console.log(`  Child Context: ${child.context} | URL: ${child.url} | Parent: ${child.parent}`);
  }

  const sameChild = hostCtx?.children?.find(c => c.url.includes(':8090'));
  const crossChild = hostCtx?.children?.find(c => c.url.includes(':8091'));

  const testFile = resolve(FIXTURES_DIR, 'upload-small.txt');

  // Test Same-Origin Iframe
  if (sameChild) {
    console.log('\n--- Testing Same-Origin Iframe Upload ---');
    const elRes = await send('script.evaluate', {
      expression: "document.getElementById('subframe-file-input')",
      target: { context: sameChild.context },
      awaitPromise: false,
      resultOwnership: 'root'
    });
    console.log('Same-origin element sharedId:', elRes.result?.result?.sharedId);
    const setFilesRes = await send('input.setFiles', {
      context: sameChild.context,
      element: { sharedId: elRes.result?.result?.sharedId },
      files: [testFile]
    });
    console.log('Same-origin setFiles result:', JSON.stringify(setFilesRes));
    const statusRes = await send('script.evaluate', {
      expression: "document.getElementById('subframe-status').innerText",
      target: { context: sameChild.context }
    });
    console.log('Same-origin status:', statusRes.result?.result?.value);
  }

  // Test Cross-Origin Iframe
  if (crossChild) {
    console.log('\n--- Testing Cross-Origin Iframe Upload ---');
    const elRes = await send('script.evaluate', {
      expression: "document.getElementById('subframe-file-input')",
      target: { context: crossChild.context },
      awaitPromise: false,
      resultOwnership: 'root'
    });
    console.log('Cross-origin element sharedId:', elRes.result?.result?.sharedId);
    const setFilesRes = await send('input.setFiles', {
      context: crossChild.context,
      element: { sharedId: elRes.result?.result?.sharedId },
      files: [testFile]
    });
    console.log('Cross-origin setFiles result:', JSON.stringify(setFilesRes));
    const statusRes = await send('script.evaluate', {
      expression: "document.getElementById('subframe-status').innerText",
      target: { context: crossChild.context }
    });
    console.log('Cross-origin status:', statusRes.result?.result?.value);
  }

  ws.close();
  proc.kill();
  server1.close();
  server2.close();
}

testIframeUploads().catch(console.error);

