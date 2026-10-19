import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSignal, type HubSocket, type RateWindow } from '../src/hubLogic.ts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
function base32(bytes: Uint8Array): string {
  let buffer = 0;
  let bits = 0;
  let out = '';
  for (const b of bytes) {
    buffer = (buffer << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(buffer >> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(buffer << (5 - bits)) & 31];
  return out;
}

type Member = { id: string; pair: CryptoKeyPair };
async function member(): Promise<Member> {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return { id: base32(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), pair };
}

const now = () => Math.floor(Date.now() / 1000);

async function message(from: Member, body: object, tamper = false) {
  const text = JSON.stringify(body);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, from.pair.privateKey, new TextEncoder().encode(text)));
  return JSON.stringify({ body: tamper ? text.replace('offer', 'answer') : text, sig: btoa(String.fromCharCode(...signature)) });
}

function fakeSockets() {
  const inbox = new Map<string, string[]>();
  const open = new Map<string, number>();
  const socketsFor = (key: string): HubSocket[] => Array.from({ length: open.get(key) ?? 0 }, () => ({ send: (data: string) => { inbox.set(key, [...(inbox.get(key) ?? []), data]); } }));
  return { inbox, open, socketsFor };
}

const signal = (from: Member, to: Member, extra: object = {}) => ({ v: 1, key: from.id, to: to.id, kind: 'offer', payload: '{"session":"s","sdp":"v=0"}', ts: now(), ...extra });

test('a signed message is pushed to the recipient unchanged', async () => {
  const a = await member(); const b = await member();
  const { inbox, open, socketsFor } = fakeSockets();
  open.set(b.id, 1);
  const text = await message(a, signal(a, b));
  const reply = await handleSignal(a.id, text, now(), { w: 0, n: 0 }, socketsFor);
  assert.deepEqual(reply, { type: 'ack', delivered: 1 });
  const pushed = JSON.parse(inbox.get(b.id)![0]);
  assert.equal(pushed.type, 'signal');
  assert.equal(pushed.body, JSON.parse(text).body, 'the exact signed bytes');
  assert.equal(pushed.sig, JSON.parse(text).sig);
  const key = await crypto.subtle.importKey('raw', await crypto.subtle.exportKey('raw', a.pair.publicKey), { name: 'Ed25519' }, false, ['verify']);
  assert.ok(await crypto.subtle.verify({ name: 'Ed25519' }, key, Uint8Array.from(atob(pushed.sig), (c) => c.charCodeAt(0)), new TextEncoder().encode(pushed.body)), 'the recipient can verify the sender');
});

test('a recipient who is not connected gets nothing and the sender is told', async () => {
  const a = await member(); const b = await member();
  const { socketsFor } = fakeSockets();
  assert.deepEqual(await handleSignal(a.id, await message(a, signal(a, b)), now(), { w: 0, n: 0 }, socketsFor), { type: 'ack', delivered: 0 });
});

test('every connection of the recipient receives it', async () => {
  const a = await member(); const b = await member();
  const { inbox, open, socketsFor } = fakeSockets();
  open.set(b.id, 2);
  assert.deepEqual(await handleSignal(a.id, await message(a, signal(a, b)), now(), { w: 0, n: 0 }, socketsFor), { type: 'ack', delivered: 2 });
  assert.equal(inbox.get(b.id)!.length, 2);
});

test('messages that are not from the connection\'s member, altered, stale or malformed are refused', async () => {
  const a = await member(); const b = await member(); const c = await member();
  const { inbox, open, socketsFor } = fakeSockets();
  open.set(b.id, 1);
  const rate = (): RateWindow => ({ w: 0, n: 0 });
  const refused = async (text: string, why: string) => {
    const reply = await handleSignal(a.id, text, now(), rate(), socketsFor);
    assert.equal(reply.type, 'error', why);
  };
  await refused(await message(c, signal(c, b)), 'signed by someone else and not this connection\'s member');
  await refused(await message(a, signal(c, b)), 'claims to be from another member');
  await refused(await message(a, signal(a, b), true), 'altered after signing');
  await refused(await message(a, signal(a, b, { ts: now() - 3600 })), 'stale');
  await refused(await message(a, signal(a, b, { kind: 'file' })), 'unknown kind');
  await refused(await message(a, signal(a, a)), 'to itself');
  await refused(await message(a, signal(a, b, { to: 'nobody' })), 'invalid recipient');
  await refused(await message(a, signal(a, b, { payload: '' })), 'empty');
  await refused(await message(a, signal(a, b, { payload: 'x'.repeat(9000) })), 'too large');
  await refused('not json', 'not json');
  await refused(JSON.stringify({ body: 'x', sig: 'AAAA' }), 'bad signature shape');
  assert.equal(inbox.size, 0, 'nothing was delivered');
});

test('a member is limited to 30 messages a minute', async () => {
  const a = await member(); const b = await member();
  const { open, socketsFor } = fakeSockets();
  open.set(b.id, 1);
  const rate: RateWindow = { w: 0, n: 0 };
  for (let i = 0; i < 30; i++) assert.equal((await handleSignal(a.id, await message(a, signal(a, b)), now(), rate, socketsFor)).type, 'ack');
  const over = await handleSignal(a.id, await message(a, signal(a, b)), now(), rate, socketsFor);
  assert.equal(over.type, 'error');
  assert.equal((await handleSignal(a.id, await message(a, signal(a, b)), now() + 61, rate, socketsFor)).type, 'ack', 'the next minute starts fresh');
});
