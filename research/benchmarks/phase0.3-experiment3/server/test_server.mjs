/**
 * Phase 0.3 - Experiment 3: Deterministic Test Server
 * Implements dual HTTP origins (Port 8090 and 8091) for upload & download validation.
 */

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';

const FIXTURES_DIR = resolve('research/benchmarks/phase0.3-experiment3/fixtures');

// Pre-load / generate synthetic download payloads
const TEXT_PAYLOAD = Buffer.from('Agentic Browser Experiment 3: Deterministic Download Text File.\nGenerated on: 2026-09-24T14:30:00Z\n');
const JSON_PAYLOAD = Buffer.from(JSON.stringify({ status: 'ok', benchmark: 'Phase 0.3 Exp 3', items: [1, 2, 3, 4, 5] }, null, 2));
const BINARY_PAYLOAD = Buffer.from([0x00, 0xFF, 0x5A, 0xA5, 0x12, 0x34, 0x56, 0x78, 0xDE, 0xAD, 0xBE, 0xEF]);
const PAYLOAD_1MB = Buffer.concat([Buffer.from('SYNTHETIC_1MB_DOWNLOAD_PAYLOAD_').subarray(0, 32), Buffer.alloc(1024 * 1024 - 32, 0x42)]);
const PAYLOAD_10MB = Buffer.concat([Buffer.from('SYNTHETIC_10MB_DOWNLOAD_PAYLOAD').subarray(0, 32), Buffer.alloc(10 * 1024 * 1024 - 32, 0x43)]);

export const CHECKSUMS = {
  text: createHash('sha256').update(TEXT_PAYLOAD).digest('hex'),
  json: createHash('sha256').update(JSON_PAYLOAD).digest('hex'),
  binary: createHash('sha256').update(BINARY_PAYLOAD).digest('hex'),
  oneMb: createHash('sha256').update(PAYLOAD_1MB).digest('hex'),
  tenMb: createHash('sha256').update(PAYLOAD_10MB).digest('hex'),
};

const UPLOAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Upload Validation Fixture</title></head>
<body>
  <h1>Agentic Browser File Upload Test Bed</h1>
  
  <form id="upload-form" action="/submit-upload" method="POST" enctype="multipart/form-data">
    <div class="field">
      <label for="file-input-visible">Visible File Input:</label>
      <input type="file" id="file-input-visible" name="file_visible">
    </div>

    <div class="field">
      <label for="file-input-hidden">Hidden File Input:</label>
      <input type="file" id="file-input-hidden" name="file_hidden" style="display:none;">
    </div>

    <div class="field">
      <label for="file-input-disabled">Disabled File Input:</label>
      <input type="file" id="file-input-disabled" name="file_disabled" disabled>
    </div>

    <div class="field">
      <label for="file-input-multi">Multi File Input:</label>
      <input type="file" id="file-input-multi" name="files_multi" multiple>
    </div>

    <div id="dynamic-container"></div>

    <button type="submit" id="submit-btn">Submit Upload Form</button>
  </form>

  <div id="status-panel" style="margin-top:20px; border:1px solid #ccc; padding:10px;">
    <h3>Client File Event Log</h3>
    <pre id="file-status">{"status":"initialized","files":[]}</pre>
  </div>

  <script>
    function updateStatus(inputId) {
      const input = document.getElementById(inputId);
      const fileList = [];
      if (input && input.files) {
        for (let i = 0; i < input.files.length; i++) {
          const f = input.files[i];
          fileList.push({ name: f.name, size: f.size, type: f.type });
        }
      }
      const data = {
        inputId: inputId,
        count: fileList.length,
        files: fileList,
        timestamp: Date.now()
      };
      document.getElementById('file-status').innerText = JSON.stringify(data, null, 2);
    }

    ['file-input-visible', 'file-input-hidden', 'file-input-disabled', 'file-input-multi'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => updateStatus(id));
    });

    window.createDynamicInput = function(id = 'dynamic-file-input', multiple = false) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.id = id;
      inp.name = id;
      if (multiple) inp.multiple = true;
      inp.addEventListener('change', () => updateStatus(id));
      document.getElementById('dynamic-container').appendChild(inp);
      return id;
    };
  </script>
</body>
</html>`;

const IFRAME_UPLOAD_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Subframe Upload</title></head>
<body>
  <h3>Subframe Upload Target</h3>
  <input type="file" id="subframe-file-input" name="subframe_file">
  <pre id="subframe-status">{"status":"subframe-initialized","count":0}</pre>
  <script>
    document.getElementById('subframe-file-input').addEventListener('change', (e) => {
      const files = [];
      for (const f of e.target.files) {
        files.push({ name: f.name, size: f.size, type: f.type });
      }
      document.getElementById('subframe-status').innerText = JSON.stringify({
        origin: window.location.origin,
        count: files.length,
        files: files
      }, null, 2);
    });
  </script>
</body>
</html>`;

const IFRAME_HOST_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Iframe Host Portal</title></head>
<body>
  <h1>Parent Portal Host</h1>
  <div style="margin-bottom:20px;">
    <h3>Same-Origin Frame (Port 8090)</h3>
    <iframe id="frame-same" src="http://127.0.0.1:8090/iframe_upload.html" width="500" height="200"></iframe>
  </div>
  <div>
    <h3>Cross-Origin Frame (Port 8091)</h3>
    <iframe id="frame-cross" src="http://127.0.0.1:8091/iframe_upload.html" width="500" height="200"></iframe>
  </div>
</body>
</html>`;

const DOWNLOAD_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Download Trigger Fixture</title></head>
<body>
  <h1>Download Trigger Test Bed</h1>
  <p><a id="link-direct-text" href="/download/text" download="direct-text.txt">Direct Text Download</a></p>
  <p><a id="link-direct-1mb" href="/download/1mb" download="direct-1mb.bin">Direct 1MB Download</a></p>
  <p><a id="link-direct-10mb" href="/download/10mb" download="direct-10mb.bin">Direct 10MB Download</a></p>
  <p><button id="btn-blob-download">Trigger Blob Download</button></p>
  <p><button id="btn-data-download">Trigger Data URL Download</button></p>
  <p><a id="link-download-404" href="/download/404" download="notfound.txt">404 Download</a></p>
  <p><a id="link-download-abort" href="/download/abort" download="aborted.bin">Aborted Download</a></p>
  <p><a id="link-download-invalid-length" href="/download/invalid-length" download="corrupted.bin">Corrupted Length Download</a></p>
  <p><a id="link-download-traversal-rel" href="/download/traversal-rel">Traversal Relative Download</a></p>
  <p><a id="link-download-traversal-abs" href="/download/traversal-abs">Traversal Absolute Download</a></p>
  <p><a id="link-download-slow" href="/download/slow" download="slow-stream.bin">Slow Stream Download</a></p>
  <p><a id="link-download-collision" href="/download/collision" download="collision-test.txt">Collision Test Download</a></p>

  <script>
    document.getElementById('btn-blob-download').addEventListener('click', () => {
      const blob = new Blob(["Synthetic Blob Content from JavaScript\\nTimestamp: " + Date.now()], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = "blob-download.txt";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 500);
    });

    document.getElementById('btn-data-download').addEventListener('click', () => {
      const dataUri = "data:text/plain;base64,U3ludGhldGljIERhdGEgVVJMIERvd25sb2FkIFRlc3QgZm9yIEFnZW50aWMgQnJvd3Nlcg==";
      const a = document.createElement('a');
      a.href = dataUri;
      a.download = "data-uri-download.txt";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => document.body.removeChild(a), 500);
    });
  </script>
</body>
</html>`;

function handleRequest(req, res, originPort) {
  const url = req.url.split('?')[0];

  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (url === '/upload.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(UPLOAD_HTML);
  } else if (url === '/iframe_host.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(IFRAME_HOST_HTML);
  } else if (url === '/iframe_upload.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(IFRAME_UPLOAD_HTML);
  } else if (url === '/download_page.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(DOWNLOAD_PAGE_HTML);
  } else if (url === '/download/text') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename="download-text.txt"',
      'Content-Length': TEXT_PAYLOAD.length
    });
    res.end(TEXT_PAYLOAD);
  } else if (url === '/download/json') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="download-data.json"',
      'Content-Length': JSON_PAYLOAD.length
    });
    res.end(JSON_PAYLOAD);
  } else if (url === '/download/binary') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="download-binary.bin"',
      'Content-Length': BINARY_PAYLOAD.length
    });
    res.end(BINARY_PAYLOAD);
  } else if (url === '/download/1mb') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="download-1mb.bin"',
      'Content-Length': PAYLOAD_1MB.length
    });
    res.end(PAYLOAD_1MB);
  } else if (url === '/download/10mb') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="download-10mb.bin"',
      'Content-Length': PAYLOAD_10MB.length
    });
    res.end(PAYLOAD_10MB);
  } else if (url === '/download/404') {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } else if (url === '/download/abort') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="aborted.bin"',
      'Content-Length': 1024 * 1024
    });
    res.write(Buffer.alloc(256, 0x41));
    setTimeout(() => {
      req.socket.destroy();
    }, 50);
  } else if (url === '/download/invalid-length') {
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="corrupted.bin"',
      'Content-Length': 500000
    });
    res.end(Buffer.alloc(256, 0x42));
  } else if (url === '/download/traversal-rel') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename="../../traversal-test.txt"',
      'Content-Length': 27
    });
    res.end('Directory traversal attempt\n');
  } else if (url === '/download/traversal-abs') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename="C:\\Windows\\Temp\\traversal-abs.txt"',
      'Content-Length': 36
    });
    res.end('Absolute path traversal attempt payload\n');
  } else if (url === '/download/collision') {
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Content-Disposition': 'attachment; filename="collision-test.txt"',
      'Content-Length': 30
    });
    res.end('Collision test file content.\n');
  } else if (url === '/download/slow') {
    // 3MB total in 6 chunks of 500KB every 300ms
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="slow-stream.bin"',
      'Content-Length': 3 * 1024 * 1024
    });
    let chunksSent = 0;
    const interval = setInterval(() => {
      chunksSent++;
      res.write(Buffer.alloc(512 * 1024, 0x53)); // 'S'
      if (chunksSent >= 6) {
        clearInterval(interval);
        res.end();
      }
    }, 300);
  } else if (url === '/submit-upload' && req.method === 'POST') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const fullBuffer = Buffer.concat(chunks);
      const cType = req.headers['content-type'] || '';
      
      // Simple boundary check & metadata extraction
      const boundaryMatch = cType.match(/boundary=(?:["']?)([^"';]+)/i);
      const boundary = boundaryMatch ? boundaryMatch[1] : null;

      // Extract form field parts
      const parts = [];
      if (boundary) {
        const partsRaw = fullBuffer.toString('binary').split('--' + boundary);
        for (const p of partsRaw) {
          if (p.includes('filename="')) {
            const nameMatch = p.match(/name="([^"]+)"/);
            const fnameMatch = p.match(/filename="([^"]+)"/);
            const typeMatch = p.match(/Content-Type:\s*([^\r\n]+)/i);
            const headerEnd = p.indexOf('\r\n\r\n');
            if (headerEnd !== -1) {
              const bodyStr = p.substring(headerEnd + 4, p.length - 2);
              const bodyBuf = Buffer.from(bodyStr, 'binary');
              parts.push({
                fieldName: nameMatch ? nameMatch[1] : 'unknown',
                filename: fnameMatch ? fnameMatch[1] : 'unknown',
                contentType: typeMatch ? typeMatch[1] : 'unknown',
                size: bodyBuf.length,
                sha256: createHash('sha256').update(bodyBuf).digest('hex')
              });
            }
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(JSON.stringify({
        status: 'received',
        totalBytesReceived: fullBuffer.length,
        boundary: boundary,
        filesReceived: parts
      }, null, 2));
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
}

export function startServers(port1 = 8090, port2 = 8091) {
  return new Promise((resolveAll) => {
    const s1 = createServer((req, res) => handleRequest(req, res, port1));
    const s2 = createServer((req, res) => handleRequest(req, res, port2));

    s1.listen(port1, '127.0.0.1', () => {
      s2.listen(port2, '127.0.0.1', () => {
        console.log(`[Test Server] Primary Origin:   http://127.0.0.1:${port1}/`);
        console.log(`[Test Server] Secondary Origin: http://127.0.0.1:${port2}/`);
        resolveAll({ server1: s1, server2: s2 });
      });
    });
  });
}

// Direct execution support
if (process.argv[1].endsWith('test_server.mjs')) {
  startServers().then(() => console.log('Servers running. Press Ctrl+C to stop.'));
}

