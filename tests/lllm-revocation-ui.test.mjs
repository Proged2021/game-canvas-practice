import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, webcrypto } from 'node:crypto';
import vm from 'node:vm';

const sources = Object.fromEntries(await Promise.all(['relay', 'studio', 'vault'].map(async name =>
  [name, await readFile(new URL(`../lllm/${name}.js`, import.meta.url), 'utf8')])));
const publicKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const settle = async () => { for (let index = 0; index < 8; index++) await new Promise(resolve => setImmediate(resolve)); };

function relayHarness(handler) {
  const window = new EventTarget(), events = [], calls = [];
  window.fetch = async (url, options = {}) => { calls.push({ url, options }); return handler(url, options); };
  window.addEventListener('lllmaccessrevoked', event => events.push(event.detail));
  const context = vm.createContext({ window, document: { querySelector: () => ({ content: 'demo' }) },
    crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Headers, Response, Blob, DOMException,
    CustomEvent, btoa, atob, location: { origin: 'https://game-canvas.app' }, setTimeout, console });
  vm.runInContext(sources.relay, context);
  return { window, events, calls };
}

test('a base authorization denial preserves HTTP metadata, revokes once and blocks new relay jobs', async () => {
  const harness = relayHarness(async (_url, options) => options.method === 'POST'
    ? Response.json({ ok: true })
    : Response.json({ error: '双方のワークスペースへの参加が必要です', code: 'MEMBERSHIP_REQUIRED' }, { status: 403 }));
  await assert.rejects(harness.window.fetch('/api/status'), error => error.status === 403 && error.code === 'MEMBERSHIP_REQUIRED');
  assert.equal(harness.events.length, 1);
  assert.equal(harness.events[0].status, 403);
  const calls = harness.calls.length;
  await assert.rejects(harness.window.fetch('/api/status'), error => error.status === 403);
  assert.equal(harness.events.length, 1);
  assert.equal(harness.calls.length, calls);
  assert.equal(harness.calls.some(call => call.options.body && JSON.parse(call.options.body).action === 'create'), false);
});

for (const baseStatus of [200, 401, 403, 404, 503]) {
  test(`an expired job only revokes if the independent base check denies access (${baseStatus})`, async () => {
    let baseReads = 0;
    const harness = relayHarness(async (url, options) => {
      if (options.method === 'POST') return Response.json({ ok: true });
      if (url.includes('?id=')) return Response.json({ error: '受付の期限が切れました', code: 'JOB_EXPIRED' }, { status: 404 });
      baseReads++;
      return baseReads === 1 || baseStatus === 200 ? Response.json({ publicKey })
        : Response.json({ error: '利用権限を確認できません', code: 'BASE_DENIED' }, { status: baseStatus });
    });
    await assert.rejects(harness.window.fetch('/api/status'), error => error.status === 404 && error.code === 'JOB_EXPIRED');
    assert.equal(baseReads, 2);
    assert.equal(harness.events.length, [401, 403, 404].includes(baseStatus) ? 1 : 0);
    if (harness.events.length) assert.equal(harness.events[0].status, baseStatus);
  });
}

test('a stopped server remains recoverable and is not treated as membership revocation', async () => {
  let online = false, creates = 0;
  const harness = relayHarness(async (url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      if (body.action === 'create') { creates++; return online ? Response.json({ ok: true }) : Response.json({ error: 'サーバー停止中', code: 'OFFLINE' }, { status: 503 }); }
      return Response.json({ ok: true });
    }
    return url.includes('?id=') ? Response.json({ error: '期限切れ', code: 'JOB_EXPIRED' }, { status: 404 }) : Response.json({ publicKey });
  });
  await assert.rejects(harness.window.fetch('/api/status'), error => error.status === 503 && error.code === 'OFFLINE');
  assert.equal(harness.events.length, 0);
  online = true;
  await assert.rejects(harness.window.fetch('/api/status'), error => error.status === 404);
  assert.equal(creates, 2);
  assert.equal(harness.events.length, 0);
});

for (const status of [401, 403]) {
  test(`a job-level ${status} preserves its error without revoking a still-authorized page`, async () => {
    const harness = relayHarness(async (_url, options) => {
      if (options.method !== 'POST') return Response.json({ publicKey });
      const body = JSON.parse(options.body);
      return body.action === 'create' ? Response.json({ error: 'request-specific rejection', code: 'REQUEST_REJECTED' }, { status }) : Response.json({ ok: true });
    });
    await assert.rejects(harness.window.fetch('/api/status'), error => error.status === status && error.code === 'REQUEST_REJECTED');
    assert.equal(harness.events.length, 0);
  });
}

function uiHarness({ studio = true, fetcher } = {}) {
  const nodes = new Map(), timers = new Map(), revokedUrls = [], calls = [], navigations = [];
  let timerId = 0, urlId = 0;
  class Node {
    constructor(id = '', tag = 'div') { this.id = id; this.tagName = tag.toUpperCase(); this.value = ''; this.hidden = false; this.disabled = false; this.children = []; this.dataset = {}; this.listeners = new Map(); this.attributes = new Map(); this.files = []; this._text = ''; this.className = ''; const classes = new Set(); this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) }; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent ?? '').join(''); }
    replaceChildren(...children) { this._text = ''; this.children = children; }
    append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } }
    addEventListener(name, listener) { const listeners = this.listeners.get(name) ?? []; listeners.push(listener); this.listeners.set(name, listeners); }
    async fire(name, event = {}) { const operations = (this.listeners.get(name) ?? []).map(listener => listener({ target: this, preventDefault() {}, ...event })); if (this['on' + name]) operations.push(this['on' + name](event)); await Promise.all(operations); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); delete this[name]; }
    querySelector(selector) { if (selector === '.bubble') return this.children.find(child => child.className.startsWith('bubble')) ?? null; return this.children.find(child => child.tagName === selector.toUpperCase()) ?? null; }
    querySelectorAll(selector) { return this.children.filter(child => selector === 'p' ? child.tagName === 'P' : child.tagName === 'BUTTON'); }
    scrollIntoView() {}
    click() {}
    closest() { return this.tagName === 'BUTTON' ? this : null; }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
  node('imageTarget').value = 'this'; node('chatModel').value = 'gemma'; node('temperature').value = '1'; node('maxTokens').value = '2048';
  node('machineStatus').parentElement = node('machineWrapper');
  node('connectionNotice').append(new Node('', 'h2'), node('connectionMessage'), new Node('', 'p'));
  node('connectionMessage').tagName = 'P';
  const tabs = ['chat', 'generate', 'edit'].map(name => { const tab = new Node('', 'button'); tab.dataset.tab = name; return tab; });
  const inputs = ['chatInput', 'systemPrompt', 'generatePrompt', 'generateNegative', 'editPrompt', 'editNegative', 'editImage', 'newChat'].map(node);
  const window = new EventTarget();
  const document = { getElementById: node, addEventListener() {}, createElement: tag => new Node('', tag),
    querySelector: selector => selector === '.vaultpanel' ? node('vaultPanel') : selector.includes('lllm-workspace') ? { content: 'demo' } : null,
    querySelectorAll: selector => selector === '[data-tab]' ? tabs : selector.startsWith('.workspace ') ? inputs : selector === '#models button' ? node('models').children.flatMap(row => row.children.filter(child => child.tagName === 'BUTTON')) : [], body: new Node('body') };
  class TestURL extends URL {}
  TestURL.createObjectURL = () => 'blob:synthetic-' + (++urlId);
  TestURL.revokeObjectURL = url => revokedUrls.push(url);
  const status = { current: 'gemma', models: [{ id: 'gemma', name: 'Gemma', running: true }], memory: { freeGiB: 8, totalGiB: 16 }, scheduler: {}, actionToken: 'synthetic' };
  const fallback = async url => url === '/api/status' ? Response.json(status) : Response.json({ canUnlock: true, recipients: [] });
  const secret = new Uint8Array(32).fill(37);
  const cryptoStub = { createSessionKey: () => ({ id: 'a'.repeat(64), pub: new Uint8Array(32), secret }), base64: () => 'synthetic-public-key',
    decryptEnvelope: () => ({ plain: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]), header: { id: 'f'.repeat(8) + '-1111-2222-3333-' + 'f'.repeat(12), mode: 'generate' } }) };
  const queue = { init() {}, ticket: () => null, isWaiting: () => false, view: () => null, update() {}, acquire: async () => 'synthetic-ticket', release: async () => {} };
  const chat = { send: async (_body, options) => { options.onAccepted(); options.onText('data: ' + JSON.stringify({ choices: [{ delta: { content: 'synthetic private reply' } }] }) + '\n'); options.onText('data: [DONE]\n'); } };
  const sandbox = { window, document, crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, URL: TestURL, Blob, Response,
    Event, CustomEvent, AbortController, console, StudioCrypto: cryptoStub, GpuQueue: queue, ChatCrypto: chat,
    location: { origin: 'https://game-canvas.app', hash: '', assign: path => navigations.push(path) }, history: { replaceState() {} }, navigator: {},
    fetch: async (url, options) => { calls.push({ url, options }); return (fetcher ?? fallback)(url, options, fallback); },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay, interval: false }); return id; }, clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay, interval: true }); return id; }, clearInterval: id => timers.delete(id), requestAnimationFrame: callback => callback() };
  const context = vm.createContext(sandbox);
  vm.runInContext(sources.vault, context); sandbox.PrivateImages = window.PrivateImages;
  if (studio) vm.runInContext(sources.studio, context);
  return { context, window, node, nodes, timers, calls, navigations, revokedUrls, status, secret, chat, privateImages: window.PrivateImages,
    revoke: (status = 403) => window.dispatchEvent(new CustomEvent('lllmaccessrevoked', { detail: { status, code: 'MEMBERSHIP_REQUIRED', message: '参加状態が変わったため利用できません。' } })) };
}

test('open chat revocation clears sensitive content, aborts the response, stops polling and ignores late callbacks', async () => {
  const harness = uiHarness(); await settle();
  harness.node('chatInput').value = 'first synthetic private prompt';
  await harness.node('sendChat').fire('click');
  assert.equal(harness.node('copyChat').disabled, false);
  assert.ok(harness.node('messages').textContent.includes('synthetic private reply'));
  let finish, callbacks;
  harness.chat.send = async (_body, options) => { callbacks = options; options.onAccepted(); options.onText('data: ' + JSON.stringify({ choices: [{ delta: { content: 'partial private reply' } }] }) + '\n'); await new Promise(resolve => { finish = resolve; }); };
  harness.node('chatInput').value = 'second synthetic private prompt'; harness.node('systemPrompt').value = 'private system instruction';
  for (const id of ['generatePrompt', 'generateNegative', 'editPrompt', 'editNegative']) harness.node(id).value = 'private image prompt';
  const sending = harness.node('sendChat').fire('click'); await settle();
  assert.ok(callbacks);
  harness.revoke();
  assert.equal(callbacks.signal.aborted, true);
  assert.equal(harness.node('messages').children.length, 0);
  for (const id of ['chatInput', 'systemPrompt', 'generatePrompt', 'generateNegative', 'editPrompt', 'editNegative']) assert.equal(harness.node(id).value, '');
  for (const id of ['sendChat', 'runGenerate', 'runEdit', 'copyChat']) assert.equal(harness.node(id).disabled, true);
  assert.equal(harness.privateImages.ready(), false);
  assert.equal(harness.timers.size, 0);
  assert.match(harness.node('connectionMessage').textContent, /参加状態/);
  assert.ok(!harness.node('machineStatus').textContent.includes('接続待ち'));
  callbacks.onAccepted(); callbacks.onText('data: ' + JSON.stringify({ choices: [{ delta: { content: 'late private reply' } }] }) + '\n'); finish(); await sending;
  assert.equal(harness.node('messages').children.length, 0);
  assert.equal(harness.node('copyChat').disabled, true);
  const calls = harness.calls.length;
  await harness.node('retryConnection').fire('click');
  assert.deepEqual(harness.navigations, ['/w/demo']);
  assert.equal(harness.calls.length, calls);
});

test('a delayed successful status response cannot unlock a revoked screen', async () => {
  let completeStatus;
  const harness = uiHarness({ fetcher: (url, _options, fallback) => url === '/api/status'
    ? new Promise(resolve => { completeStatus = () => resolve(Response.json({ current: 'gemma', models: [], memory: {}, scheduler: {} })); }) : fallback(url) });
  await settle(); harness.revoke(401); completeStatus(); await settle();
  assert.equal(harness.node('machineStatus').textContent, 'ログインを確認してください');
  assert.equal(harness.node('connectionNotice').hidden, false);
  assert.equal(harness.node('sendChat').disabled, true);
  assert.equal(harness.timers.size, 0);
});

test('503, network failure and ordinary offline recovery stay distinct without starting a model', async () => {
  let mode = 'stopped';
  const harness = uiHarness({ fetcher: async (url, _options, fallback) => {
    if (mode === 'network') throw new TypeError('synthetic network failure');
    if (mode === 'stopped') return Response.json({ error: 'サーバー停止中', code: 'OFFLINE' }, { status: 503 });
    return fallback(url);
  } });
  await settle(); assert.match(harness.node('machineStatus').textContent, /停止中/); assert.equal(harness.node('sendChat').disabled, true);
  mode = 'network'; await harness.node('retryConnection').fire('click'); await settle();
  assert.match(harness.node('machineStatus').textContent, /ネットワーク/);
  mode = 'online'; harness.node('chatInput').value = 'synthetic prompt'; harness.node('generatePrompt').value = 'synthetic image';
  await harness.node('retryConnection').fire('click'); await settle();
  assert.equal(harness.node('connectionNotice').hidden, true);
  assert.equal(harness.node('sendChat').disabled, false);
  assert.equal(harness.node('runGenerate').disabled, false);
  assert.equal(harness.privateImages.ready(), true);
  assert.ok(harness.timers.size > 0);
  assert.equal(harness.calls.some(call => call.url === '/api/action'), false);
});

test('revocation wipes image keys and blob URLs, and stale private status/archive replies cannot restore them', async () => {
  const harness = uiHarness({ studio: false });
  let resolveStatus, resolveArchive, delayed = false;
  const api = async path => {
    if (path === '/api/private/status') return delayed ? new Promise(resolve => { resolveStatus = resolve; }) : { canUnlock: true, recipients: [{ id: 'a'.repeat(64), label: 'synthetic recipient' }] };
    if (path.startsWith('/api/private/files?')) return new Promise(resolve => { resolveArchive = resolve; });
    return {};
  };
  await harness.privateImages.init({ api }); await harness.privateImages.prepare();
  const header = Buffer.from(JSON.stringify({ version: 1, algorithm: 'X25519-HKDF-SHA256-AES-256-GCM', mime: 'image/png', recipient: 'a'.repeat(64), mode: 'generate' }));
  const size = Buffer.alloc(4); size.writeUInt32BE(header.length);
  const envelope = Buffer.concat([Buffer.from('AISTIMG1'), size, header, Buffer.alloc(16)]);
  harness.context.fetch = async () => new Response(envelope);
  await harness.privateImages.show('/api/private/files/synthetic', 'generate');
  const displayed = harness.node('generateOutput').src; assert.match(displayed, /^blob:/);
  harness.node('vaultRecipient').value = 'a'.repeat(64);
  const archive = harness.privateImages.archive(); delayed = true; const refresh = harness.privateImages.refresh();
  harness.revoke();
  assert.ok(harness.secret.every(byte => byte === 0)); assert.ok(harness.revokedUrls.includes(displayed));
  assert.equal(harness.node('generateOutput').src, undefined); assert.equal(harness.node('generateDownload').href, undefined);
  assert.equal(harness.node('generateEncryptedDownload').href, undefined); assert.equal(harness.node('vaultFiles').children.length, 0);
  assert.equal(harness.privateImages.ready(), false); assert.equal(harness.privateImages.canUnlock(), false);
  resolveStatus({ canUnlock: true, recipients: [{ id: 'restored', label: 'must not return' }] });
  resolveArchive({ files: [{ id: 'f'.repeat(36), createdAt: 0, mode: 'generate' }] });
  await Promise.all([archive, refresh]);
  assert.equal(harness.privateImages.ready(), false); assert.equal(harness.node('vaultFiles').children.length, 0);
  await assert.rejects(harness.privateImages.prepare(), /利用権限/);
});
