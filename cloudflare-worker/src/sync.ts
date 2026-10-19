import type { Hono } from 'hono';

// HMS Data Sync rendezvous: lets members find each other's current address while they are online.
// It stores NO files and no feed content, only who is online, under what name, and where to connect.
// Every write is signed by the member's own Ed25519 key, so nobody can announce for someone else.

type SyncEnv = { DB: D1Database };

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const CLOCK_SKEW_SECONDS = 300;
const ONLINE_SECONDS = 600;
const MAX_LISTED = 200;
const MAX_KEYS_PER_ADDRESS = 10;
const STALE_UNCLAIMED_SECONDS = 30 * 24 * 3600;
const MAX_BODY_BYTES = 1024;

interface PresenceRow {
  key: string;
  iracing_id: number | null;
  name: string;
  ip: string;
  port: number;
  listed: number;
  last_seen: number;
  ts: number;
}

/** A member ID is the unpadded lowercase base32 of the 32-byte Ed25519 public key. */
export function decodeMemberKey(id: unknown): Uint8Array | null {
  if (typeof id !== 'string' || id.length !== 52) return null;
  let buffer = 0;
  let bits = 0;
  const out: number[] = [];
  for (const ch of id) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 5) | value;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return out.length === 32 ? Uint8Array.from(out) : null;
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

async function verifySignature(key: Uint8Array, body: Uint8Array, signature: Uint8Array): Promise<boolean> {
  try {
    const imported = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, imported, signature, body);
  } catch {
    return false;
  }
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name.length >= 1 && name.length <= 24 ? name : null;
}

function validAddress(ip: string | undefined): ip is string {
  if (!ip || ip.length > 45) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.split('.').every((p) => Number(p) <= 255);
  return /^[0-9a-fA-F:]+$/.test(ip) && ip.includes(':');
}

function endpoint(row: PresenceRow): string {
  return row.ip.includes(':') ? `[${row.ip}]:${row.port}` : `${row.ip}:${row.port}`;
}

function publicMember(row: PresenceRow, includeId: boolean) {
  return {
    id: row.key,
    name: row.name,
    iracingId: includeId ? row.iracing_id : null,
    endpoint: endpoint(row),
    seen: row.last_seen,
  };
}

/** Reads and authenticates a signed request. Returns the parsed body and the member's row, or an error response. */
async function readSigned(c: any): Promise<{ body: any; keyId: string } | Response> {
  const raw = new Uint8Array(await c.req.arrayBuffer());
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return c.json({ ok: false, message: 'Bad request size' }, 400);
  let body: any;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return c.json({ ok: false, message: 'Body is not JSON' }, 400);
  }
  const key = decodeMemberKey(body?.key);
  const signature = fromBase64(c.req.header('X-HMS-Signature') ?? '');
  if (!key || !signature || signature.length !== 64) return c.json({ ok: false, message: 'Missing or malformed key or signature' }, 400);
  if (body.v !== 1 || !Number.isInteger(body.ts)) return c.json({ ok: false, message: 'Unsupported request' }, 400);
  if (Math.abs(Date.now() / 1000 - body.ts) > CLOCK_SKEW_SECONDS) return c.json({ ok: false, message: 'Clock is off by more than five minutes' }, 400);
  if (!(await verifySignature(key, raw, signature))) return c.json({ ok: false, message: 'Signature does not match the member key' }, 401);
  return { body, keyId: body.key as string };
}

export function registerSyncRoutes<E extends { Bindings: SyncEnv }>(app: Hono<E>): void {
  const noStore = (c: any) => c.header('Cache-Control', 'no-store');

  // A member says: I am online, here is my name, optional iRacing ID, and the port I listen on.
  app.post('/api/sync/v1/announce', async (c) => {
    noStore(c);
    const signed = await readSigned(c);
    if (signed instanceof Response) return signed;
    const { body, keyId } = signed;
    const name = cleanName(body.name);
    const iracingId = body.iracingId === null || body.iracingId === undefined ? null : body.iracingId;
    const port = body.port;
    const ip = c.req.header('CF-Connecting-IP');
    if (!name) return c.json({ ok: false, message: 'Name must be 1 to 24 characters' }, 400);
    if (iracingId !== null && !(Number.isInteger(iracingId) && iracingId >= 1 && iracingId <= 99999999)) return c.json({ ok: false, message: 'Invalid iRacing ID' }, 400);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return c.json({ ok: false, message: 'Invalid port' }, 400);
    if (typeof body.listed !== 'boolean') return c.json({ ok: false, message: 'listed must be true or false' }, 400);
    if (!validAddress(ip)) return c.json({ ok: false, message: 'Could not determine your address' }, 400);

    const now = Math.floor(Date.now() / 1000);
    const existing = (await c.env.DB.prepare(`SELECT * FROM sync_presence WHERE key = ?`).bind(keyId).first()) as PresenceRow | null;
    if (existing && body.ts <= existing.ts) return c.json({ ok: false, message: 'Stale announcement' }, 409);

    // One iRacing ID, one member key. The first key to claim an ID keeps it until it releases it.
    if (iracingId !== null) {
      const other = (await c.env.DB.prepare(`SELECT key FROM sync_presence WHERE iracing_id = ? AND key <> ?`).bind(iracingId, keyId).first()) as { key: string } | null;
      if (other) return c.json({ ok: false, message: `iRacing ID ${iracingId} is already used by another member` }, 409);
    }
    // Keep one address from creating unlimited members.
    const crowd = (await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM sync_presence WHERE ip = ? AND last_seen > ? AND key <> ?`).bind(ip, now - 3600, keyId).first()) as { n: number } | null;
    if (crowd && crowd.n >= MAX_KEYS_PER_ADDRESS) return c.json({ ok: false, message: 'Too many members from this address' }, 429);

    try {
      await c.env.DB.prepare(
        `INSERT INTO sync_presence (key, iracing_id, name, ip, port, listed, last_seen, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET iracing_id = excluded.iracing_id, name = excluded.name, ip = excluded.ip,
           port = excluded.port, listed = excluded.listed, last_seen = excluded.last_seen, ts = excluded.ts`
      ).bind(keyId, iracingId, name, ip, port, body.listed ? 1 : 0, now, body.ts).run();
    } catch (err: any) {
      if (String(err?.message ?? err).includes('UNIQUE')) return c.json({ ok: false, message: `iRacing ID ${iracingId} is already used by another member` }, 409);
      throw err;
    }
    // Housekeeping: forget members with no claimed ID who have been gone a month.
    const cleanup = c.env.DB.prepare(`DELETE FROM sync_presence WHERE iracing_id IS NULL AND last_seen < ?`).bind(now - STALE_UNCLAIMED_SECONDS).run();
    try {
      c.executionCtx.waitUntil(cleanup);
    } catch {
      await cleanup; // no execution context (for example in tests)
    }
    return c.json({ ok: true, endpoint: ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}` });
  });

  // A member says: I am going offline. Their iRacing ID stays claimed.
  app.post('/api/sync/v1/leave', async (c) => {
    noStore(c);
    const signed = await readSigned(c);
    if (signed instanceof Response) return signed;
    await c.env.DB.prepare(`UPDATE sync_presence SET last_seen = 0, listed = 0 WHERE key = ? AND ts < ?`).bind(signed.keyId, signed.body.ts).run();
    return c.json({ ok: true });
  });

  // Members who chose to be listed and are online now.
  app.get('/api/sync/v1/members', async (c) => {
    noStore(c);
    const since = Math.floor(Date.now() / 1000) - ONLINE_SECONDS;
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM sync_presence WHERE listed = 1 AND last_seen > ? ORDER BY name COLLATE NOCASE LIMIT ${MAX_LISTED}`
    ).bind(since).all();
    return c.json({ ok: true, members: (results as unknown as PresenceRow[]).map((r) => publicMember(r, true)) });
  });

  // Where is this member right now? By member ID (listed or not, because the ID is the shared secret), or by iRacing ID (listed members only).
  app.get('/api/sync/v1/lookup', async (c) => {
    noStore(c);
    const since = Math.floor(Date.now() / 1000) - ONLINE_SECONDS;
    const id = c.req.query('id');
    const iracing = c.req.query('iracingId');
    let row: PresenceRow | null = null;
    if (id) {
      if (!decodeMemberKey(id)) return c.json({ ok: false, message: 'Invalid member ID' }, 400);
      row = (await c.env.DB.prepare(`SELECT * FROM sync_presence WHERE key = ? AND last_seen > ?`).bind(id, since).first()) as PresenceRow | null;
    } else if (iracing && /^\d{1,8}$/.test(iracing)) {
      row = (await c.env.DB.prepare(`SELECT * FROM sync_presence WHERE iracing_id = ? AND listed = 1 AND last_seen > ?`).bind(Number(iracing), since).first()) as PresenceRow | null;
    } else return c.json({ ok: false, message: 'Give id or iracingId' }, 400);
    return row ? c.json({ ok: true, member: publicMember(row, true) }) : c.json({ ok: false, message: 'Not online' }, 404);
  });
}
