/**
 * RFC 9562 UUIDv7: 48-bit Unix milliseconds, version 7, variant 0b10, then
 * random bits. For client-generated ids; the server's `z.uuid()` checks the
 * version and variant bits (contracts/primitives.ts), so a v4 would be refused.
 *
 * Uniqueness is what matters here, not unpredictability: the one current use,
 * a nudge's idempotency key, is unique per sender (`nudges` has
 * UNIQUE (from_user_id, client_nudge_id)). That makes Math.random an
 * acceptable fallback where the runtime has no crypto.getRandomValues.
 */
const randomBytes = (count: number): Uint8Array => {
  const bytes = new Uint8Array(count);
  const crypto = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => void } }).crypto;
  if (crypto?.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < count; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
};

export const uuidv7 = (now: number = Date.now()): string => {
  const bytes = randomBytes(16);

  let time = now;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = time % 256;
    time = Math.floor(time / 256);
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
