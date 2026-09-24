/**
 * Probe browser.setDownloadBehavior schema
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const ZEN_EXE = resolve('staging/zen-bin/zen.exe');
const TEMP_PROFILE = resolve('research/benchmarks/phase0.3-experiment3/temp-profile');

async function probeDownloadBehavior() {
  const proc = spawn(ZEN_EXE, [
    '--remote-debugging-port', '9237',
    '--headless',
    '--profile', TEMP_PROFILE,
    'about:blank'
  ]);

  let ws = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 400));
    try {
      const testWs = new WebSocket('ws://127.0.0.1:9237/session');
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

  const tests = [
    { downloadBehavior: { type: 'allowed' } },
    { downloadBehavior: { type: 'allowed', destination: 'C:\\temp' } },
    { downloadBehavior: { type: 'allowed', downloadPath: 'C:\\temp' } },
    { downloadBehavior: { type: 'allowed', path: 'C:\\temp' } },
    { downloadBehavior: { type: 'denied' } }
  ];

  for (const t of tests) {
    const res = await send('browser.setDownloadBehavior', t);
    console.log(`Probe [${JSON.stringify(t)}]:`, JSON.stringify(res));
  }

  ws.close();
  proc.kill();
}

probeDownloadBehavior().catch(console.error);

