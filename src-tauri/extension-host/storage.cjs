'use strict';
// Extension data belongs to the profile, never to an installed code directory.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
function profileHome(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.SC_CODE_HOME || env.SC_CODE_HOME) return path.resolve(env.SC_CODE_HOME || env.SC_CODE_HOME);
  if (platform === 'win32') return path.join(env.APPDATA || path.join(home, 'AppData/Roaming'), 'ScCode');
  if (platform === 'darwin') return path.join(home, 'Library/Application Support/ScCode');
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'ScCode');
}
function extensionId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9._-]*$/i.test(id) || id.length > 255) throw new Error('Invalid extension ID');
  return id.toLowerCase();
}
function workspaceKey(folders, identity) {
  if (identity) return crypto.createHash('sha256').update(String(identity)).digest('hex');
  const normalized = folders.map(folder => {
    const resolved = path.resolve(folder);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  });
  // Folder order is part of a multi-root workspace's identity.
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
function extensionStoragePaths(id, folders = [], identity, env = process.env) {
  const root = profileHome(env), safeId = extensionId(id);
  const global = path.join(root, 'data/User/globalStorage', safeId);
  const workspace = folders.length || identity ? path.join(root, 'data/workspaceStorage', workspaceKey(folders, identity), safeId) : undefined;
  const logs = path.join(root, 'logs/extensions', safeId);
  for (const dir of [global, workspace, logs].filter(Boolean)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return { global, workspace, logs };
}
function copyMissing(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Legacy extension storage symlink requires manual migration');
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) { fs.mkdirSync(to, { recursive: true, mode: 0o700 }); copyMissing(from, to); }
    else if (entry.isFile()) {
      try { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }
}
function migrateLegacyStorage(extensionPath, paths) {
  for (const [name, target] of [['.global-storage', paths.global], ['.storage', paths.workspace]]) {
    if (!target) continue;
    const marker = path.join(target, '.sc-code-legacy-import.json'), source = path.join(extensionPath, name);
    if (fs.existsSync(marker)) continue;
    if (fs.existsSync(source)) {
      const stat = fs.lstatSync(source);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Invalid legacy extension storage');
      copyMissing(source, target);
    }
    // Old workspace storage was globally shared. Preserve its files as a seed
    // in each workspace on first use, then keep subsequent writes isolated.
    atomicState(marker, { version: 1, source });
  }
}
function readState(file) {
  if (!file) return {};
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error(`Invalid extension state: ${file}`);
    return state;
  } catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
function atomicState(file, state) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  let fd;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(state)); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    fs.renameSync(tmp, file);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(tmp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
async function withStateLock(file, update) {
  const lock = file + '.lock', until = Date.now() + 2500;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= until) throw new Error(`Extension state is locked: ${file}. Close other ScCode instances; a crash lock may need recovery.`);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  try { return update(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
function createMemento(file) {
  let state = readState(file), tail = Promise.resolve();
  return {
    keys: () => Object.keys(state),
    get: (key, defaultValue) => Object.prototype.hasOwnProperty.call(state, key) ? state[key] : defaultValue,
    update(key, value) {
      if (typeof key !== 'string') return Promise.reject(new Error('Memento key must be a string'));
      let snapshot;
      try { snapshot = value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }
      catch (error) { return Promise.reject(error); }
      const commit = () => {
        const next = file ? readState(file) : { ...state };
        if (snapshot === undefined) delete next[key]; else Object.defineProperty(next, key, { value: snapshot, enumerable: true, writable: true, configurable: true });
        if (file) atomicState(file, next);
        state = next;
      };
      const result = tail.then(() => file ? withStateLock(file, commit) : commit());
      tail = result.catch(() => {});
      return result;
    },
    // Recording selection is not a claim that cloud Settings Sync is implemented.
    setKeysForSync: () => {},
  };
}
function disabledExtension(id, env = process.env) {
  const disabled = env.SC_CODE_DISABLE_EXTENSION_IDS ?? '';
  return disabled.split(',').some(value => value.trim().toLowerCase() === id.toLowerCase());
}
function createSecretStorage(id, request) {
  const ownedId = extensionId(id), listeners = new Set();
  const call = (operation, key, value) => {
    if (typeof key !== 'string' || !key.length) return Promise.reject(new Error('Secret key must be a nonempty string'));
    if (operation === 'store' && typeof value !== 'string') return Promise.reject(new Error('Secret value must be a string'));
    return request(ownedId, operation, key, value);
  };
  const changed = key => { for (const listener of listeners) { try { listener({ key }); } catch {} } };
  return {
    get: key => call('get', key).then(value => value === null ? undefined : value),
    store: (key, value) => call('store', key, value).then(() => changed(key)),
    delete: key => call('delete', key).then(() => changed(key)),
    onDidChange(listener, thisArg, disposables) {
      const bound = listener.bind(thisArg); listeners.add(bound);
      const disposable = { dispose: () => listeners.delete(bound) }; disposables?.push(disposable); return disposable;
    },
  };
}
module.exports = { profileHome, extensionId, workspaceKey, extensionStoragePaths, migrateLegacyStorage, createMemento, disabledExtension, createSecretStorage };
