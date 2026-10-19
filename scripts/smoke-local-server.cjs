'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const http = require('node:http'), net = require('node:net'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
function request(port, route, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: route, headers, timeout: 3000 }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.once('upgrade', (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.once('timeout', () => req.destroy(new Error('request deadline exceeded')));
    req.once('error', reject);
  });
}
async function smoke() {
  const binary = path.join(root, '.runtime/desktop', process.platform === 'win32' ? 'sc-code-agent.exe' : 'sc-code-agent');
  if (!fs.existsSync(binary)) throw new Error('Run npm run runtime:prepare first');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-code-server-smoke-'));
  const port = await freePort(), token = crypto.randomBytes(32).toString('hex');
  // Only the minimum OS environment: no inherited API keys, credentials, or real profile.
  const env = { SC_CODE_HOME: profile, SC_CODE_LOCAL_TOKEN: token, SC_CODE_LIVE_PRICING: '0', SC_CODE_TELEMETRY: '0',
    SC_CODE_PORT: String(port), SC_CODE_BIND_ADDR: '127.0.0.1', SC_CODE_NO_AUTH: '1',
    HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile, TMP: profile, TEMP: profile };
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'Path', 'PATHEXT']) {
    const key = Object.keys(process.env).find(key => key.toLowerCase() === name.toLowerCase());
    if (key) env[name === 'Path' ? 'PATH' : name] = process.env[key];
  }
  const child = spawn(binary, [], { cwd: profile, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let exited = false, output = '', startError;
  child.on('exit', () => { exited = true; });
  child.on('error', error => { startError = error; });
  child.stderr.on('data', data => { output = (output + data).slice(-6000); });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100 && !exited && !startError; attempt++) {
      try { ready = await request(port, '/v1/health') === 200; } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw startError || new Error(`Isolated agent did not become ready:\n${output}`);
    const auth = { Authorization: `Bearer ${token}` };
    const upgrade = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), Origin: 'https://tauri.localhost' };
    const checks = [
      ['health is public', '/v1/health', {}, 200],
      ['REST rejects missing token', '/v1/models', {}, 401],
      ['REST accepts supervised token', '/v1/models', auth, 200],
      ['REST rejects query-only token', `/v1/models?token=${token}`, {}, 401],
      ['REST rejects incorrect token', '/v1/models', { Authorization: 'Bearer wrong' }, 401],
      ['REST rejects hostile Origin', '/v1/models', { ...auth, Origin: 'https://attacker.invalid' }, 403],
      ['REST rejects rebinding Host', '/v1/models', { ...auth, Host: 'attacker.invalid' }, 403],
      ['WebSocket rejects missing token', '/v1/stream', upgrade, 401],
      ['WebSocket rejects hostile Origin', `/v1/stream?token=${token}`, { ...upgrade, Origin: 'https://attacker.invalid' }, 403],
      ['WebSocket upgrades with session token', `/v1/stream?token=${token}`, upgrade, 101],
    ];
    for (const [name, route, headers, status] of checks) {
      assert.equal(await request(port, route, headers), status, name);
      console.log(`PASS ${name}`);
    }
    console.log('10 live-agent checks passed using a temporary isolated profile; no provider calls.');
  } finally {
    if (!exited && child.pid) {
      const exit = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exit;
    }
    const resolved = fs.realpathSync(profile);
    if (!path.basename(resolved).startsWith('sc-code-server-smoke-') || path.dirname(resolved) !== fs.realpathSync(os.tmpdir())) throw new Error('Refusing unexpected cleanup path');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}
smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
