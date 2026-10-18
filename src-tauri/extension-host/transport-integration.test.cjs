'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { once } = require('node:events');
function request(port, pathname, upgrade) {
  return new Promise((resolve, reject) => {
    const headers = upgrade ? { Origin: 'https://tauri.localhost', Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') } : {};
    const req = http.get({ hostname: '127.0.0.1', port, path: pathname, headers });
    req.on('response', res => { const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() })); });
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve({ status: res.statusCode }); });
    req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('request timeout')));
  });
}
test('real extension host rejects unauthenticated websocket and health does not leak credential', { timeout: 10000 }, async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-code-host-'));
  const token = crypto.randomUUID();
  const child = spawn(process.execPath, [path.join(__dirname, 'server.cjs')], {
    env: { ...process.env, SC_CODE_HOME: home, SC_CODE_EXT_HOST_TOKEN: token, SIDEX_EXTENSION_SEARCH_PATHS: '[]', SIDEX_INIT_DATA_FILE: '' },
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, 'exit'); child.stdin.end(); await exited; }
    fs.rmSync(home, { recursive: true, force: true });
  });
  const port = await new Promise((resolve, reject) => {
    let text = ''; child.stdout.on('data', chunk => { text += chunk; if (text.includes('\n')) { try { resolve(JSON.parse(text.split('\n')[0]).port); } catch(e) { reject(e); } } });
    child.on('error', reject); child.on('exit', code => reject(new Error(`host exited ${code}`)));
  });
  const health = await request(port, '/', false);
  assert.equal(health.status, 200); assert.ok(!health.body.includes(token));
  assert.equal((await request(port, '/', true)).status, 403);
  assert.equal((await request(port, '/?token=wrong', true)).status, 403);
  assert.equal((await request(port, `/?token=${token}`, true)).status, 101);
  assert.ok(fs.existsSync(path.join(home, 'data')));
});
