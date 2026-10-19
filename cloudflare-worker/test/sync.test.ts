import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { registerSyncRoutes } from '../src/sync.ts';

// The real routes run against a real SQLite database (D1 is SQLite) through a thin D1-shaped adapter.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../src/db/migration_03_sync_presence.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => (db.prepare(sql).get(...(args as any[])) as any) ?? null,
            run: async () => {
              db.prepare(sql).run(...(args as any[]));
              return { success: true };
            },
            all: async () => ({ results: db.prepare(sql).all(...(args as any[])) }),
          };
        },
      };
    },
  } as unknown as D1Database;
}

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
  const id = base32(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { id, pair };
}

async function signed(m: Member, body: object, ip = '203.0.113.5', tamper = false) {
  const raw = new TextEncoder().encode(JSON.stringify(body));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, m.pair.privateKey, raw));
  const sent = tamper ? new TextEncoder().encode(JSON.stringify({ ...body, name: 'Mallory' })) : raw;
  return { method: 'POST', body: sent, headers: { 'X-HMS-Signature': btoa(String.fromCharCode(...signature)), 'CF-Connecting-IP': ip } };
}

const now = () => Math.floor(Date.now() / 1000);

function announce(m: Member, extra: object = {}) {
  return { v: 1, key: m.id, iracingId: null, name: 'Pat', port: 47121, listed: true, ts: now(), ...extra };
}

function setup() {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  registerSyncRoutes(app);
  const env = { DB: fakeD1() };
  const call = (path: string, init?: RequestInit) => app.request(path, init, env);
  return { call };
}

test('a signed announcement is listed and can be looked up', async () => {
  const { call } = setup();
  const a = await member();
  const res = await call('/api/sync/v1/announce', await signed(a, announce(a, { iracingId: 123456, name: 'Alice' })));
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).endpoint, '203.0.113.5:47121');
  const list = (await (await call('/api/sync/v1/members')).json()) as any;
  assert.deepEqual(list.members.map((m: any) => [m.id, m.name, m.iracingId, m.endpoint]), [[a.id, 'Alice', 123456, '203.0.113.5:47121']]);
  const byId = (await (await call(`/api/sync/v1/lookup?id=${a.id}`)).json()) as any;
  const byIracing = (await (await call('/api/sync/v1/lookup?iracingId=123456')).json()) as any;
  assert.equal(byId.member.name, 'Alice');
  assert.equal(byIracing.member.id, a.id);
});

test('an unlisted member is found only by the member ID, never by iRacing ID or in the list', async () => {
  const { call } = setup();
  const a = await member();
  await call('/api/sync/v1/announce', await signed(a, announce(a, { iracingId: 777, listed: false })));
  assert.deepEqual(((await (await call('/api/sync/v1/members')).json()) as any).members, []);
  assert.equal((await call(`/api/sync/v1/lookup?id=${a.id}`)).status, 200);
  assert.equal((await call('/api/sync/v1/lookup?iracingId=777')).status, 404);
});

test('requests must be signed by the key they name', async () => {
  const { call } = setup();
  const a = await member();
  const b = await member();
  assert.equal((await call('/api/sync/v1/announce', await signed(a, announce(a), '203.0.113.5', true))).status, 401, 'altered body');
  assert.equal((await call('/api/sync/v1/announce', await signed(b, announce(a)))).status, 401, 'someone else signed');
  assert.equal((await call('/api/sync/v1/announce', { method: 'POST', body: JSON.stringify(announce(a)), headers: { 'CF-Connecting-IP': '203.0.113.5' } })).status, 400, 'unsigned');
  assert.equal((await call('/api/sync/v1/announce', await signed(a, { ...announce(a), key: 'short' }))).status, 400, 'bad key');
});

test('old, replayed and badly timed announcements are refused', async () => {
  const { call } = setup();
  const a = await member();
  const first = announce(a, { ts: now() });
  assert.equal((await call('/api/sync/v1/announce', await signed(a, first))).status, 200);
  assert.equal((await call('/api/sync/v1/announce', await signed(a, first))).status, 409, 'replay');
  assert.equal((await call('/api/sync/v1/announce', await signed(a, announce(a, { ts: now() - 3600 })))).status, 400, 'old clock');
  assert.equal((await call('/api/sync/v1/announce', await signed(a, announce(a, { ts: now() + 5 })))).status, 200, 'newer is fine');
});

test('only one member key can hold an iRacing ID, and it can be released', async () => {
  const { call } = setup();
  const a = await member();
  const b = await member();
  assert.equal((await call('/api/sync/v1/announce', await signed(a, announce(a, { iracingId: 42 })))).status, 200);
  const clash = await call('/api/sync/v1/announce', await signed(b, announce(b, { iracingId: 42, name: 'Bea' }), '203.0.113.6'));
  assert.equal(clash.status, 409);
  assert.match(((await clash.json()) as any).message, /already used/);
  assert.equal((await call('/api/sync/v1/announce', await signed(b, announce(b, { name: 'Bea' }), '203.0.113.6'))).status, 200, 'no ID is fine');
  assert.equal((await call('/api/sync/v1/announce', await signed(a, announce(a, { iracingId: null, ts: now() + 1 })))).status, 200, 'release');
  assert.equal((await call('/api/sync/v1/announce', await signed(b, announce(b, { iracingId: 42, ts: now() + 1 }), '203.0.113.6'))).status, 200, 'now free');
});

test('leaving removes the listing but keeps the iRacing ID claimed', async () => {
  const { call } = setup();
  const a = await member();
  const b = await member();
  await call('/api/sync/v1/announce', await signed(a, announce(a, { iracingId: 9 })));
  assert.equal((await call('/api/sync/v1/leave', await signed(a, { v: 1, key: a.id, ts: now() + 2 }))).status, 200);
  assert.equal((await call(`/api/sync/v1/lookup?id=${a.id}`)).status, 404);
  assert.deepEqual(((await (await call('/api/sync/v1/members')).json()) as any).members, []);
  assert.equal((await call('/api/sync/v1/announce', await signed(b, announce(b, { iracingId: 9 }), '203.0.113.7'))).status, 409);
});

test('input is validated and one address cannot make unlimited members', async () => {
  const { call } = setup();
  const a = await member();
  for (const bad of [{ name: '' }, { name: 'x'.repeat(25) }, { port: 0 }, { port: 70000 }, { iracingId: 0 }, { iracingId: 1.5 }, { listed: 'yes' }])
    assert.equal((await call('/api/sync/v1/announce', await signed(a, announce(a, bad)))).status, 400, JSON.stringify(bad));
  const noAddress = await signed(a, announce(a));
  assert.equal((await call('/api/sync/v1/announce', { method: 'POST', body: noAddress.body, headers: { 'X-HMS-Signature': noAddress.headers['X-HMS-Signature'] } })).status, 400, 'no address header');
  for (let i = 0; i < 10; i++) {
    const m = await member();
    assert.equal((await call('/api/sync/v1/announce', await signed(m, announce(m), '198.51.100.9'))).status, 200);
  }
  const extra = await member();
  assert.equal((await call('/api/sync/v1/announce', await signed(extra, announce(extra), '198.51.100.9'))).status, 429);
  assert.equal((await call('/api/sync/v1/announce', await signed(extra, announce(extra), '198.51.100.10'))).status, 200, 'another address is fine');
  const v6 = await member();
  const res = await call('/api/sync/v1/announce', await signed(v6, announce(v6), '2001:db8::1'));
  assert.equal(((await res.json()) as any).endpoint, '[2001:db8::1]:47121');
});

test('lookups reject malformed queries', async () => {
  const { call } = setup();
  assert.equal((await call('/api/sync/v1/lookup')).status, 400);
  assert.equal((await call('/api/sync/v1/lookup?id=nope')).status, 400);
  assert.equal((await call('/api/sync/v1/lookup?iracingId=abc')).status, 400);
});
