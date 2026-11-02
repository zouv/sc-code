'use strict';
// Windows/WebView2 integration against a freshly built binary and disposable profile.
// No real accounts, keyring reads, SSH keys, paid models or installer execution.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const exe = path.resolve(arg('exe') || path.join(root, '.runtime/target/debug/ScCode.exe'));
const logDir = path.join(root, '.runtime/logs');
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function invoke(page, command, args = {}) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(({ command, args }) => globalThis.__TAURI_INTERNALS__.invoke(command, args), { command, args }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Native IPC timed out: ${command}`)), 30_000); }),
    ]);
  } finally { clearTimeout(timer); }
}
async function denied(page, command, args) {
  await assert.rejects(invoke(page, command, args), /requires a trusted workspace|not trusted|restricted|permission/i);
}
async function started(page) {
  try {
    await page.waitForFunction(() => performance.getEntriesByType('mark').some(mark => mark.name === 'code/didStartWorkbench'), undefined, { timeout: 60_000 });
    await page.waitForFunction(() => typeof globalThis.__sc_code_request_close === 'function', undefined, { timeout: 30_000 });
  } catch (error) {
    await page.screenshot({ path: path.join(logDir, 'all-native-smoke-failed.png') }).catch(() => {});
    throw new Error(`Workbench not ready at ${page.url()}: ${await page.evaluate(() => document.body?.innerText.slice(0, 1000)).catch(() => '')}`, { cause: error });
  }
}
async function main() {
  assert.equal(process.platform, 'win32', 'This smoke requires Windows/WebView2');
  assert.ok(fs.existsSync(exe), 'Build the current native executable first');
  for (const file of ['src-tauri/src/lib.rs', 'src-tauri/src/workspace_permissions.rs', 'src-tauri/src/commands/window.rs', 'src-tauri/src/commands/process.rs', 'crates/sc-code-remote/src/ssh.rs', 'src-tauri/src/taskbar.rs', '.runtime/dist/index.html']) {
    assert.ok(fs.statSync(exe).mtimeMs >= fs.statSync(path.join(root, file)).mtimeMs, `Native binary is stale for ${file}`);
  }
  assert.ok(!fs.existsSync(path.join(root, '.env')), 'Native smoke refuses repository .env credentials');
  fs.mkdirSync(logDir, { recursive: true });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-code-native-smoke-'));
  const profile = path.join(temp, 'profile'), workspace = path.join(temp, 'workspace');
  fs.mkdirSync(profile); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'synthetic.txt'), 'native smoke fixture\n');
  const env = { SC_CODE_HOME: profile, HOME: profile, USERPROFILE: profile, APPDATA: profile, LOCALAPPDATA: profile,
    TEMP: temp, TMP: temp, SC_CODE_LIVE_PRICING: '0', SC_CODE_TELEMETRY: '0' };
  for (const name of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT']) {
    const key = Object.keys(process.env).find(key => key.toLowerCase() === name.toLowerCase());
    if (key) { env[name] = process.env[key]; }
  }
  const port = await freePort();
  env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`;
  const child = spawn(exe, [`--open-folder=${Buffer.from(pathToFileURL(workspace).href).toString('base64url')}`], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', spawnError;
  child.on('error', error => { spawnError = error; });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  let browser;
  const checks = [];
  const check = message => { checks.push(message); console.log(`[smoke:desktop] OK ${message}`); };
  try {
    let endpoint;
    for (let n = 0; n < 100; n++) {
      if (spawnError) { throw spawnError; }
      if (child.exitCode !== null) { throw new Error(`Native app exited early (${child.exitCode}): ${output.slice(-2000)}`); }
      try { const response = await fetch(`http://127.0.0.1:${port}/json/version`); endpoint = (await response.json()).webSocketDebuggerUrl; if (endpoint) { break; } } catch {}
      await sleep(200);
    }
    assert.ok(endpoint, 'Scoped WebView2 CDP endpoint did not start');
    browser = await chromium.connectOverCDP(endpoint);
    const context = browser.contexts()[0];
    let page;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) { throw new Error(`Native app exited early (${child.exitCode}): ${output.slice(-2000)}`); }
      page = context.pages().find(p => /tauri\.localhost/.test(p.url()));
      if (page) { break; }
      await sleep(100);
    }
    assert.ok(page, `Native workbench page missing; pages=${context.pages().map(p => p.url()).join(', ')}; app=${output.slice(-2000)}`);
    await started(page);
    check('fresh WebView2 workbench starts with isolated folder/profile');
    const session = await invoke(page, 'workspace_reset_trust');
    const execArgs = { command: 'cmd.exe', args: ['/d', '/c', 'echo SC_NATIVE_EXEC_OK'], cwd: workspace, timeoutMs: 5000 };
    await denied(page, 'exec', execArgs);
    await denied(page, 'real_ext_host_start', { hostId: 'smoke-old' });
    assert.equal(await invoke(page, 'read_file', { path: path.join(workspace, 'synthetic.txt') }), 'native smoke fixture\n');
    await invoke(page, 'write_file', { path: path.join(workspace, 'written.txt'), content: 'safe native editing\n' });
    assert.equal(fs.readFileSync(path.join(workspace, 'written.txt'), 'utf8'), 'safe native editing\n');
    check('restricted native execution denied, ordinary editing still works');
    const search = await page.evaluate(async ({ root }) => {
      globalThis.__smokeSearchMatches = [];
      const callback = globalThis.__TAURI_INTERNALS__.transformCallback(raw => {
        if (Array.isArray(raw.message)) { globalThis.__smokeSearchMatches.push(...raw.message); }
      });
      return globalThis.__TAURI_INTERNALS__.invoke('search_text_stream', { root, query: 'native smoke fixture', options: {}, requestId: 424242, onFile: `__CHANNEL__:${callback}` });
    }, { root: workspace });
    assert.equal(search.match_count, 1);
    await page.waitForFunction(() => globalThis.__smokeSearchMatches.length === 1, undefined, { timeout: 5000 });
    assert.match((await page.evaluate(() => globalThis.__smokeSearchMatches[0])).path, /synthetic\.txt$/);
    check('restricted workspace native search returns streamed Channel matches');
    await invoke(page, 'workspace_set_trust', { session, revision: 1, trusted: true });
    const executed = await invoke(page, 'exec', execArgs);
    assert.equal(executed.exit_code, 0); assert.match(executed.stdout, /SC_NATIVE_EXEC_OK/);
    const old = await invoke(page, 'real_ext_host_start', { hostId: 'smoke-old' });
    const next = await invoke(page, 'real_ext_host_start', { hostId: 'smoke-next' });
    assert.notEqual(old.pid, next.pid);
    await invoke(page, 'real_ext_host_stop', { hostId: 'smoke-old' });
    assert.equal((await invoke(page, 'real_ext_host_start', { hostId: 'smoke-next' })).pid, next.pid);
    check('authorized execution, native Node generation isolation and idempotent start');
    const secondUrl = new URL(page.url()); secondUrl.searchParams.delete('folder');
    const secondPromise = context.waitForEvent('page', { timeout: 30_000 });
    secondPromise.catch(() => {}); // Observe rejection even if native creation fails first.
    await invoke(page, 'create_window', { label: 'workspace-native-smoke', title: 'ScCode smoke', url: secondUrl.href });
    const second = await secondPromise; await started(second);
    const secondSession = await invoke(second, 'workspace_reset_trust');
    await denied(second, 'real_ext_host_start', { hostId: 'smoke-next' });
    await invoke(second, 'workspace_set_trust', { session: secondSession, revision: 1, trusted: true });
    const peer = await invoke(second, 'real_ext_host_start', { hostId: 'smoke-next' });
    assert.notEqual(peer.pid, next.pid); assert.notEqual(peer.port, next.port);
    await invoke(page, 'workspace_set_trust', { session, revision: 2, trusted: false });
    await denied(page, 'exec', execArgs);
    assert.equal((await invoke(second, 'real_ext_host_start', { hostId: 'smoke-next' })).pid, peer.pid);
    await invoke(page, 'workspace_set_trust', { session, revision: 3, trusted: true });
    const recovered = await invoke(page, 'real_ext_host_start', { hostId: 'smoke-next' });
    assert.notEqual(recovered.pid, next.pid);
    check('two native windows isolate authorization/hosts; revoke and regrant recover');
    const replacement = await invoke(page, 'workspace_reset_trust');
    await assert.rejects(invoke(page, 'workspace_set_trust', { session, revision: 99, trusted: true }), /stale/i);
    await denied(page, 'exec', execArgs);
    await invoke(page, 'workspace_set_trust', { session: replacement, revision: 1, trusted: true });
    check('reload session rejects stale authorization');
    await page.evaluate(async ({ cwd }) => {
      globalThis.__smokeTerminalEvents = [];
      const callback = globalThis.__TAURI_INTERNALS__.transformCallback(raw => { if (raw.message) { globalThis.__smokeTerminalEvents.push(raw.message); } });
      globalThis.__smokeTerminalId = await globalThis.__TAURI_INTERNALS__.invoke('terminal_spawn', { shell: 'cmd.exe', args: ['/d', '/c', 'echo SC_NATIVE_TERMINAL_OK'], cwd, onEvent: `__CHANNEL__:${callback}` });
    }, { cwd: workspace });
    await page.waitForFunction(() => globalThis.__smokeTerminalEvents.some(event => event.kind === 'exit'), undefined, { timeout: 20_000 });
    const terminal = await page.evaluate(() => globalThis.__smokeTerminalEvents);
    assert.match(terminal.filter(event => event.kind === 'data').map(event => event.data).join(''), /SC_NATIVE_TERMINAL_OK/);
    check('native PTY output and exit Channel work');
    const frameOrigin = await invoke(page, 'webview_host_origin');
    await page.evaluate(origin => { const frame = document.createElement('iframe'); frame.id = 'smoke-isolated-frame'; frame.src = `${origin}/pre/index.html`; document.body.appendChild(frame); }, frameOrigin);
    let frame;
    for (let n = 0; n < 50; n++) { frame = page.frames().find(f => f.url().startsWith(frameOrigin)); if (frame) { break; } await sleep(100); }
    assert.ok(frame, 'Isolated extension frame missing');
    assert.equal(await frame.evaluate(() => { try { return typeof parent.__TAURI_INTERNALS__.invoke === 'function'; } catch { return false; } }), false);
    await page.evaluate(() => document.getElementById('smoke-isolated-frame').remove());
    check('extension frame cannot reach top-level native bridge');
    const forwardedPromise = context.waitForEvent('page', { timeout: 30_000 });
    forwardedPromise.catch(() => {});
    const launcher = spawn(exe, [`--open-folder=${Buffer.from(pathToFileURL(workspace).href).toString('base64url')}`], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
    let launcherTimer;
    try {
      const exitCode = await Promise.race([
        new Promise((resolve, reject) => { launcher.once('exit', resolve); launcher.once('error', reject); }),
        new Promise((_, reject) => { launcherTimer = setTimeout(() => reject(new Error('Single-instance launcher timed out')), 10_000); }),
      ]);
      assert.equal(exitCode, 0);
    } finally {
      clearTimeout(launcherTimer);
      if (launcher.pid && launcher.exitCode === null) { spawnSync('taskkill.exe', ['/PID', String(launcher.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
    }
    const forwarded = await forwardedPromise; await started(forwarded);
    check('single-instance CLI forwards a folder into a live secondary workbench');
    await page.screenshot({ path: path.join(logDir, 'all-native-smoke.png') });
    await invoke(page, 'close_window', { label: 'workspace-native-smoke' });
    await invoke(page, 'real_ext_host_stop', { hostId: 'smoke-next' });
    await invoke(page, 'workspace_set_trust', { session: replacement, revision: 2, trusted: false });
    await browser.close(); browser = null;
    const report = { checks, passed: checks.length, profileIsDisposable: true, executable: path.relative(root, exe) };
    fs.writeFileSync(path.join(logDir, 'all-native-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    fs.writeFileSync(path.join(logDir, 'all-native-app.log'), output);
    if (browser) { await browser.close().catch(() => {}); }
    if (child.exitCode === null) { spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); }
    // Only our verified mkdtemp root can be removed; never remove the real profile.
    const resolved = path.resolve(temp), prefix = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(prefix) && path.basename(resolved).startsWith('sc-code-native-smoke-'));
    await sleep(500);
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
}
main().catch(error => { console.error('[smoke:desktop] failed:', error); process.exitCode = 1; });
