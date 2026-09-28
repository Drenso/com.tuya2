import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);

// Load the real app/utility code, replacing only Homey and infrastructure.
// No Homey SDK, credentials, network client or device is instantiated.
function loadModule(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  const localRequire = id => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    throw new Error(`Unexpected dependency: ${id}`);
  };
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  return module.exports;
}

const utils = loadModule('../lib/TuyaOAuth2Util.ts', { crypto: require('node:crypto') });

async function setup(overrides = {}) {
  const cards = new Map();
  const errors = [];
  const calls = { status: 0, specifications: 0, dataPoints: 0, writes: 0 };
  function card(id) {
    if (!cards.has(id))
      cards.set(id, {
        registerRunListener(fn) {
          this.run = fn;
          return this;
        },
        registerArgumentAutocompleteListener(_name, fn) {
          this.autocomplete = fn;
          return this;
        },
      });
    return cards.get(id);
  }
  class OAuth2App {
    homey = { flow: { getActionCard: card, getDeviceTriggerCard: card }, __: key => key };
    async onOAuth2Init() {}
    log() {}
    error(error) {
      errors.push(error);
    }
  }
  class Cache extends Map {
    constructor() {
      super();
    }
  }
  const { default: App } = loadModule('../app.ts', {
    homey: { env: {} },
    'source-map-support': { install() {} },
    '@drenso/homey-log': { Log: class {} },
    'homey-oauth2app': { OAuth2App },
    'node-cache': Cache,
    './lib/TuyaOAuth2Util.js': utils,
    './lib/TuyaHaClient.js': class {},
  });
  const write = () => {
    calls.writes++;
    throw new Error('Device writes are forbidden in these tests');
  };
  const device = {
    getData: () => ({ deviceId: 'fixture-device' }),
    async getStatus() {
      calls.status++;
      return overrides.status ? overrides.status() : [];
    },
    async queryDataPoints() {
      calls.dataPoints++;
      return overrides.dataPoints ? overrides.dataPoints() : { properties: [] };
    },
    async getSpecification() {
      calls.specifications++;
      return overrides.specifications ? overrides.specifications() : { functions: [] };
    },
    sendCommand: write,
    setDataPoint: write,
    triggerCapabilityListener: write,
  };
  const app = new App();
  await app.onOAuth2Init();
  return {
    calls,
    errors,
    lookup: (kind = 'boolean', query = '', receiving = false) =>
      cards.get(`${receiving ? 'receive_status' : 'send_command'}_${kind}`).autocomplete(query, { device }),
  };
}

const functions = (...types) => ({ functions: types.map(([code, type]) => ({ code, type, values: '{}' })) });
const option = id => ({ id, name: id, title: id, dataPoint: false });

test('discovers a writable Boolean function without a reported status and never writes', async () => {
  const h = await setup({ specifications: () => functions(['switch', 'Boolean']) });
  assert.deepEqual(await h.lookup(), [option('switch')]);
  assert.equal(h.calls.writes, 0);
});

test('maps declared command types to the four sending cards', async () => {
  const h = await setup({
    specifications: () =>
      functions(
        ['power', 'Boolean'],
        ['level', 'Integer'],
        ['label', 'String'],
        ['mode', 'Enum'],
        ['scene', 'Json'],
        ['raw', 'Raw'],
      ),
  });
  assert.deepEqual(await h.lookup('boolean'), [option('power')]);
  assert.deepEqual(await h.lookup('number'), [option('level')]);
  assert.deepEqual(await h.lookup('string'), [option('label'), option('mode')]);
  assert.deepEqual(await h.lookup('json'), [option('scene')]);
});

test('receiving cards never query writable function specifications', async () => {
  const h = await setup({
    status: () => [{ code: 'power', value: true }],
    specifications: () => {
      throw new Error('must not query');
    },
  });
  assert.deepEqual(await h.lookup('boolean', '', true), [option('power')]);
  assert.equal(h.calls.specifications, 0);
});

test('preserves live value filtering and deduplicates a function also present in status', async () => {
  const h = await setup({
    status: () => [
      { code: 'power', value: false },
      { code: 'config', value: '{"x":1}' },
    ],
    specifications: () => functions(['power', 'Boolean']),
  });
  assert.deepEqual(await h.lookup(), [option('power')]);
  assert.deepEqual(await h.lookup('json'), [option('config')]);
});

test('successful empty responses do not invent power commands', async () => {
  const h = await setup();
  await assert.rejects(h.lookup(), /error_retrieving_codes/);
  assert.equal(h.calls.writes, 0);
});

test('distinguishes upstream failure from empty responses and retries failed lookups', async () => {
  let failed = true;
  const h = await setup({
    status: () => {
      if (failed) throw new Error('fixture API failure');
      return [{ code: 'power', value: false }];
    },
  });
  await assert.rejects(h.lookup(), /error_retrieving_code_sources/);
  failed = false;
  assert.deepEqual(await h.lookup(), [option('power')]);
  assert.equal(h.calls.status, 2);
  assert.equal(h.calls.specifications, 1);
});

test('uses available function results after status lookup failure', async () => {
  const h = await setup({
    status: () => {
      throw new Error('fixture failure');
    },
    specifications: () => functions(['power', 'Boolean']),
  });
  assert.deepEqual(await h.lookup(), [option('power')]);
  assert.equal(h.errors.length, 1);
});

test('uses status when specifications fail and retries specifications rather than caching failure', async () => {
  const h = await setup({
    status: () => [{ code: 'power', value: true }],
    specifications: () => {
      throw new Error('fixture failure');
    },
  });
  assert.deepEqual(await h.lookup(), [option('power')]);
  assert.deepEqual(await h.lookup(), [option('power')]);
  assert.equal(h.calls.status, 1);
  assert.equal(h.calls.specifications, 2);
});

test('search trims whitespace and ignores case; no match returns an empty list', async () => {
  const h = await setup({ status: () => [{ code: 'switch', value: true }] });
  assert.deepEqual(await h.lookup('boolean', ' SWI '), [option('switch')]);
  assert.deepEqual(await h.lookup('boolean', 'nonexistent'), []);
});

test('missing optional functions is a successful empty specification', async () => {
  const h = await setup({ specifications: () => ({ category: 'jsq' }) });
  await assert.rejects(h.lookup(), /error_retrieving_codes/);
});

test('does not treat prototype property names as inherited autocomplete entries', async () => {
  const h = await setup({ specifications: () => functions(['__proto__', 'Boolean']) });
  assert.deepEqual(await h.lookup(), [option('__proto__')]);
});

test('all receiving card types remain based on reported values only', async () => {
  const h = await setup({
    status: () => [
      { code: 'power', value: true },
      { code: 'level', value: 2 },
      { code: 'mode', value: 'auto' },
      { code: 'config', value: '{"mode":1}' },
    ],
  });
  for (const [kind, code] of [
    ['boolean', 'power'],
    ['number', 'level'],
    ['string', 'mode'],
    ['json', 'config'],
  ]) {
    assert.deepEqual(await h.lookup(kind, '', true), [option(code)]);
  }
  assert.equal(h.calls.specifications, 0);
  assert.equal(h.calls.writes, 0);
});

test('caches successful empty responses and does not expose specification status as commands', async () => {
  const h = await setup({
    specifications: () => ({ functions: [], status: [{ code: 'power', type: 'Boolean', values: '{}' }] }),
  });
  await assert.rejects(h.lookup(), /error_retrieving_codes/);
  await assert.rejects(h.lookup(), /error_retrieving_codes/);
  assert.equal(h.calls.status, 1);
  assert.equal(h.calls.specifications, 1);
});

test('keeps an unmatched search empty even when an optional source fails', async () => {
  const h = await setup({
    status: () => [{ code: 'power', value: true }],
    specifications: () => {
      throw new Error('fixture failure');
    },
  });
  assert.deepEqual(await h.lookup('boolean', 'unmatched'), []);
});

test('prefers standard status over duplicate data points and preserves data-point-only routing', async () => {
  const h = await setup({
    status: () => [{ code: 'power', value: true }],
    dataPoints: () => ({
      properties: [
        { code: 'power', value: true },
        { code: 'spray', value: false },
      ],
    }),
  });
  assert.deepEqual(await h.lookup(), [option('power'), { ...option('spray'), dataPoint: true }]);
});

test('retries failed specifications when no status codes are available', async () => {
  let failed = true;
  const h = await setup({
    specifications: () => {
      if (failed) throw new Error('fixture failure');
      return functions(['power', 'Boolean']);
    },
  });
  await assert.rejects(h.lookup(), /error_retrieving_code_sources/);
  failed = false;
  assert.deepEqual(await h.lookup(), [option('power')]);
  assert.equal(h.calls.status, 1);
  assert.equal(h.calls.specifications, 2);
});

test('device specification wrapper forwards only the device ID to the read API', async () => {
  class OAuth2Device {
    getData() {
      return { deviceId: 'fixture-device' };
    }
  }
  const { default: Device } = loadModule('../lib/TuyaOAuth2Device.ts', {
    'homey-oauth2app': { OAuth2Device },
    './migrations/GeneralMigrations.js': {},
    './TuyaOAuth2Util.js': utils,
  });
  const device = new Device();
  const specification = functions(['power', 'Boolean']);
  const reads = [];
  device.oAuth2Client = {
    async getSpecification(id) {
      reads.push(id);
      return specification;
    },
    sendCommands() {
      throw new Error('Unexpected device command');
    },
  };
  assert.equal(await device.getSpecification(), specification);
  assert.deepEqual(reads, ['fixture-device']);
});
