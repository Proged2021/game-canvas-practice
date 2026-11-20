import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { generateKeyPairSync, webcrypto, privateDecrypt, createCipheriv, randomBytes } from 'node:crypto';

const source = await readFile(new URL('../lllm/relay.js', import.meta.url), 'utf8');
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
const origin = 'https://game-canvas.example';
const capability = 'a'.repeat(64);
const privateReply = 'synthetic private response that must not reach a closed page';

function deferred() {
  let resolve;
  const promise = new Promise(complete => { resolve = complete; });
  return { promise, resolve };
}

function harness(delayAt) {
  const window = new EventTarget(), calls = [], events = [];
  const reachedDelay = deferred(), releaseDelay = deferred();
  let responseWire;
  window.addEventListener('lllmaccessrevoked', event => events.push(event.detail));
  window.fetch = async (input, options = {}) => {
    const url = new URL(input, origin), body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url: url.pathname + url.search, options, body });
    if (!body && !url.search) return Response.json({ publicKey });
    if (body?.action === 'chunk') {
      const wire = Buffer.from(body.ciphertext, 'base64');
      const rawKey = privateDecrypt({ key: pair.privateKey, oaepHash: 'sha256' }, wire.subarray(0, 256));
      const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', rawKey, iv);
      const packet = Buffer.from(JSON.stringify({ status: 200, headers: { 'content-type': 'text/plain' },
        body: Buffer.from(privateReply).toString('base64') }));
      try {
        cipher.setAAD(Buffer.from('lllm-v1:res:' + body.id));
        responseWire = Buffer.concat([iv, cipher.update(packet), cipher.final(), cipher.getAuthTag()]).toString('base64');
      } finally { rawKey.fill(0); packet.fill(0); wire.fill(0); }
    }
    if (body) return Response.json({ ok: true });
    if (url.searchParams.has('part')) {
      if (delayAt === 'response') { reachedDelay.resolve(); await releaseDelay.promise; }
      return Response.json({ ciphertext: responseWire });
    }
    return Response.json({ state: 'done', response_parts: 1 });
  };
  const crypto = delayAt === 'decrypt' ? {
    getRandomValues: webcrypto.getRandomValues.bind(webcrypto), randomUUID: webcrypto.randomUUID.bind(webcrypto),
    subtle: {
      importKey: webcrypto.subtle.importKey.bind(webcrypto.subtle),
      encrypt: webcrypto.subtle.encrypt.bind(webcrypto.subtle),
      async decrypt(...args) {
        // Use the real AES-GCM operation, then hold the successful result until
        // pagehide has destroyed the browser capability and cleared the UI.
        const plaintext = await webcrypto.subtle.decrypt(...args);
        reachedDelay.resolve(); await releaseDelay.promise;
        return plaintext;
      },
    },
  } : webcrypto;
  const context = vm.createContext({ window,
    document: { querySelector: selector => selector.includes('lllm-session')
      ? { content: capability, remove() {} } : { content: 'demo' } },
    crypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, Headers, Response, Blob, DOMException, CustomEvent,
    btoa, atob, location: { origin, hash: '' }, history: { replaceState() {} }, setTimeout, console });
  vm.runInContext(source, context);
  return { window, calls, events, reachedDelay: reachedDelay.promise, releaseDelay: releaseDelay.resolve };
}

for (const delayAt of ['response', 'decrypt']) {
  test(`pagehide rejects a late successful ${delayAt} instead of returning decrypted content`, { timeout: 5_000 }, async () => {
    const client = harness(delayAt);
    const pending = client.window.fetch('/api/status');
    // Attach the rejection handler before releasing the delayed successful
    // operation so a regression cannot create an unhandled rejection.
    let returnedReply = false;
    const result = pending.then(async response => { returnedReply = (await response.text()).includes(privateReply); });
    await client.reachedDelay;
    client.window.dispatchEvent(new Event('pagehide'));
    client.releaseDelay();
    await assert.rejects(result, error => error.status === 404 && error.code === 'LLLM_PAGE_CLOSED');
    assert.equal(returnedReply, false);
    assert.equal(client.events.length, 1);
    assert.equal(client.events[0].code, 'LLLM_PAGE_CLOSED');
    const closeCalls = client.calls.filter(call => call.body?.action === 'closeSession');
    assert.equal(closeCalls.length, 1);
    assert.equal(closeCalls[0].options.keepalive, true);
    assert.equal(closeCalls[0].options.headers['X-Lllm-Session'], capability);
    const callsAfterClose = client.calls.length;
    await assert.rejects(client.window.fetch('/api/status'), error => error.status === 404 && error.code === 'LLLM_PAGE_CLOSED');
    assert.equal(client.calls.length, callsAfterClose);
  });
}
