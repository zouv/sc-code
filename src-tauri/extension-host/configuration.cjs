'use strict';

const { isDeepStrictEqual } = require('util');

class ActivationGate {
  constructor() {
    this._ready = false;
    this._waiters = [];
  }

  async wait() {
    while (!this._ready) {
      await new Promise((resolve) => this._waiters.push(resolve));
    }
  }

  get isOpen() {
    return this._ready;
  }

  close() {
    if (!this._ready) return;
    this._ready = false;
    for (const resolve of this._waiters.splice(0)) resolve();
  }

  open() {
    if (this._ready) return;
    this._ready = true;
    for (const resolve of this._waiters.splice(0)) resolve();
  }
}

class ConfigurationStore {
  constructor(onDidChange) {
    this._defaults = new Map();
    this._workbench = new Map();
    this._runtime = new Map();
    this._onDidChange = onDidChange;
  }

  setDefault(key, value) {
    this._defaults.set(key, value);
  }

  get(key) {
    const values = this._effectiveEntries();
    if (values.has(key)) return values.get(key);
    const prefix = `${key}.`;
    if (![...values.keys()].some((candidate) => candidate.startsWith(prefix))) return undefined;
    const nested = {};
    for (const [candidate, value] of values) {
      if (candidate.startsWith(prefix)) assignNested(nested, candidate.slice(prefix.length), value);
    }
    return nested;
  }

  has(key) {
    const values = this._effectiveEntries();
    return values.has(key) || [...values.keys()].some((candidate) => candidate.startsWith(`${key}.`));
  }

  setRuntime(key, value) {
    const before = this._effectiveEntries();
    this._runtime.set(key, value);
    this._fireChanged(before);
  }

  deleteRuntime(key) {
    const before = this._effectiveEntries();
    this._runtime.delete(key);
    this._fireChanged(before);
  }

  inspect(key) {
    return {
      defaultValue: this._defaults.get(key),
      globalValue: this._effectiveEntries().get(key),
      workbenchValue: this._workbench.get(key),
      runtimeValue: this._runtime.get(key),
    };
  }

  replaceWorkbench(settings) {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new TypeError('configuration snapshot must be an object');
    }

    const before = this._effectiveEntries();
    const previousWorkbench = this._workbench;
    const nextWorkbench = new Map(Object.entries(settings));
    const keys = new Set([...previousWorkbench.keys(), ...nextWorkbench.keys()]);
    for (const key of keys) {
      if (previousWorkbench.has(key) !== nextWorkbench.has(key) ||
          !isDeepStrictEqual(previousWorkbench.get(key), nextWorkbench.get(key))) {
        this._runtime.delete(key);
      }
    }
    this._workbench = nextWorkbench;
    return this._fireChanged(before);
  }

  entries() {
    return [...this._effectiveEntries().entries()];
  }

  section(section) {
    const prefix = section ? `${section}.` : '';
    const result = {};
    for (const [key, value] of this._effectiveEntries()) {
      if (prefix && key === section) {
        Object.assign(result, value);
      } else if (!prefix || key.startsWith(prefix)) {
        assignNested(result, prefix ? key.slice(prefix.length) : key, value);
      }
    }
    return result;
  }

  _fireChanged(before) {
    const after = this._effectiveEntries();
    const keys = new Set([...before.keys(), ...after.keys()]);
    const changed = [...keys].filter((key) =>
      before.has(key) !== after.has(key) || !isDeepStrictEqual(before.get(key), after.get(key)),
    );
    if (changed.length) this._onDidChange?.(changed);
    return changed;
  }

  _effectiveEntries() {
    const result = new Map(this._defaults);
    for (const [key, value] of this._runtime) result.set(key, value);
    for (const [key, value] of this._workbench) result.set(key, value);
    return result;
  }
}

function assignNested(target, dottedKey, value) {
  const parts = dottedKey.split('.');
  const last = parts.pop();
  let current = target;
  for (const part of parts) {
    if (!Object.prototype.hasOwnProperty.call(current, part) ||
        !current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[last] = value;
}

function createWorkspaceConfiguration(store, section) {
  const getValue = (key) => {
    if (key === undefined || key === null || key === '') return store.section(section || '');
    return store.get(section ? `${section}.${key}` : key);
  };
  const configuration = {
    get(key, defaultValue) {
      const value = getValue(key);
      return value !== undefined ? value : defaultValue;
    },
    has(key) {
      return store.has(section ? `${section}.${key}` : key);
    },
    update(key, value) {
      const full = section ? `${section}.${key}` : key;
      if (value === undefined) store.deleteRuntime(full);
      else store.setRuntime(full, value);
      return Promise.resolve();
    },
    inspect(key) {
      const full = section ? `${section}.${key}` : key;
      return { key: full, ...store.inspect(full) };
    },
    toJSON() {
      return getValue(undefined) ?? {};
    },
  };
  return new Proxy(configuration, {
    get(target, property) {
      if (property in target) return target[property];
      if (typeof property === 'string') return getValue(property);
      return undefined;
    },
  });
}

module.exports = { ActivationGate, ConfigurationStore, createWorkspaceConfiguration };
