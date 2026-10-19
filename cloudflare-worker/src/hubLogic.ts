import { decodeMemberKey, fromBase64, verifySignature } from './sync.ts';

// Connection set-up between members is pushed over a WebSocket the app keeps open, so nobody polls and nothing is stored.
// A message is the sender's own signed JSON, forwarded byte for byte: the recipient checks the signature itself, so the server cannot alter or forge it.

export const MAX_SIGNAL_BYTES = 8192;
const CLOCK_SKEW_SECONDS = 180;
const MAX_SIGNALS_PER_MINUTE = 30;

export interface HubSocket {
  send(data: string): void;
}

export interface RateWindow {
  w: number;
  n: number;
}

export type HubReply = { type: 'ack'; delivered: number } | { type: 'error'; message: string };

/**
 * Handles one message from a connected member: {"body": "<signed JSON text>", "sig": "<base64>"}. The body names the recipient (`to`), the kind
 * (`offer` or `answer`) and a payload. Delivers it to every connection the recipient has open and says how many received it.
 */
export async function handleSignal(senderKey: string, text: string, now: number, rate: RateWindow, socketsFor: (key: string) => HubSocket[]): Promise<HubReply> {
  if (text.length > MAX_SIGNAL_BYTES + 512) return { type: 'error', message: 'Message too large' };
  let envelope: any;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { type: 'error', message: 'Not JSON' };
  }
  const body: unknown = envelope?.body;
  const signature = typeof envelope?.sig === 'string' ? fromBase64(envelope.sig) : null;
  if (typeof body !== 'string' || body.length === 0 || body.length > MAX_SIGNAL_BYTES || !signature || signature.length !== 64) return { type: 'error', message: 'Malformed message' };
  let parsed: any;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { type: 'error', message: 'Body is not JSON' };
  }
  const key = decodeMemberKey(parsed?.key);
  if (!key || parsed.key !== senderKey) return { type: 'error', message: 'The message is not from this connection\'s member' };
  if (parsed.v !== 1 || !Number.isInteger(parsed.ts) || Math.abs(now - parsed.ts) > CLOCK_SKEW_SECONDS) return { type: 'error', message: 'Stale or unsupported message' };
  if (!decodeMemberKey(parsed.to) || parsed.to === senderKey) return { type: 'error', message: 'Invalid recipient' };
  if (parsed.kind !== 'offer' && parsed.kind !== 'answer') return { type: 'error', message: 'Unknown message kind' };
  if (typeof parsed.payload !== 'string' || parsed.payload.length === 0) return { type: 'error', message: 'Missing payload' };
  if (!(await verifySignature(key, new TextEncoder().encode(body), signature))) return { type: 'error', message: 'Signature does not match the member key' };
  if (now - rate.w >= 60) {
    rate.w = now;
    rate.n = 0;
  }
  if (++rate.n > MAX_SIGNALS_PER_MINUTE) return { type: 'error', message: 'Too many connection requests; wait a minute' };
  const targets = socketsFor(parsed.to);
  const delivery = JSON.stringify({ type: 'signal', body, sig: envelope.sig });
  let delivered = 0;
  for (const target of targets) {
    try {
      target.send(delivery);
      delivered++;
    } catch {
      // that connection just closed
    }
  }
  return { type: 'ack', delivered };
}
