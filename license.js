/**
 * VoxSynth DD-6 — Offline Device-ID & Cryptographic License Verifier (license.js)
 * Uses Web Crypto API HMAC-SHA256 to verify offline Device-bound activation keys
 * matching admin-keygen.html byte-for-byte with zero network dependency.
 */

const DEVICE_ID_KEY = 'voxsynth_dd6_device_id';
const LICENSE_STORAGE_KEY = 'voxsynth_dd6_pro_license';
const MASTER_UNLOCK_KEY = 'voxsynth_dd6_master_pro_unlocked';
const MASTER_ADMIN_PIN = '258099';

// Shared offline signing domain secret (identical to admin-keygen.html)
export const LICENSE_SIGNING_SECRET = 'VOXSYNTH-DD6-OFFLINE-CRYPTO-SIGNING-KEY-2026-PRO';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChunk(len = 4) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

export function getOrCreateDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id || !/^VX6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(id)) {
    id = `VX6-${randomChunk(4)}-${randomChunk(4)}-${randomChunk(4)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

function bytesToBase32Key(bytes) {
  let chars = '';
  for (let i = 0; i < 20; i++) {
    chars += ALPHABET[bytes[i % bytes.length] % ALPHABET.length];
  }
  return `PRO-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}`;
}

async function hmacSha256Bytes(secret, message) {
  const enc = new TextEncoder();
  if (window.crypto && window.crypto.subtle) {
    const key = await window.crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = await window.crypto.subtle.sign('HMAC', key, enc.encode(message));
    return new Uint8Array(sig);
  }

  // Deterministic fallback when subtle crypto is unavailable on insecure LAN origins
  const payload = enc.encode(`${secret}::${message}`);
  const out = new Uint8Array(32);
  let h = 0x811c9dc5;
  for (let i = 0; i < 32; i++) {
    for (let j = 0; j < payload.length; j++) {
      h ^= payload[j] + i;
      h = Math.imul(h, 0x01000193);
    }
    out[i] = (h >>> 0) & 0xff;
  }
  return out;
}

export async function deriveExpectedKey(deviceId, tier = 'PRO') {
  const normalizedId = String(deviceId || '').trim().toUpperCase();
  const sigBytes = await hmacSha256Bytes(LICENSE_SIGNING_SECRET, `${normalizedId}|${tier}|VOXSYNTH-DD6`);
  return bytesToBase32Key(sigBytes);
}

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export class LicenseManager {
  constructor() {
    this.deviceId = getOrCreateDeviceId();
    this.unlocked = false;
    this.activeKey = '';
  }

  async init() {
    if (localStorage.getItem(MASTER_UNLOCK_KEY) === 'true') {
      this.unlocked = true;
      this.activeKey = 'MASTER-PRO-PERMANENT';
      return true;
    }
    const savedKey = localStorage.getItem(LICENSE_STORAGE_KEY);
    if (savedKey) {
      const ok = await this.verifyKey(savedKey);
      this.unlocked = ok;
      if (ok) this.activeKey = savedKey;
    }
    return this.unlocked;
  }

  async verifyKey(inputKey) {
    const normalized = String(inputKey || '').trim().toUpperCase();
    const expected = await deriveExpectedKey(this.deviceId, 'PRO');
    return constantTimeEqual(normalized, expected);
  }

  async activate(inputKey) {
    const normalized = String(inputKey || '').trim().toUpperCase();
    const valid = await this.verifyKey(normalized);
    if (!valid) {
      return { ok: false, message: 'Invalid Activation Key for this Device ID.' };
    }
    localStorage.setItem(LICENSE_STORAGE_KEY, normalized);
    this.unlocked = true;
    this.activeKey = normalized;
    return { ok: true, message: 'VoxSynth DD-6 Pro Unlocked Permanently!' };
  }

  unlockViaMasterPin(pin) {
    const clean = String(pin || '').replace(/\D/g, '');
    if (constantTimeEqual(clean, MASTER_ADMIN_PIN)) {
      localStorage.setItem(MASTER_UNLOCK_KEY, 'true');
      this.unlocked = true;
      this.activeKey = 'MASTER-PRO-PERMANENT';
      return { ok: true, message: 'Master Pro Unlocked!' };
    }
    return { ok: false, message: 'Invalid Master PIN.' };
  }

  isPro() {
    return this.unlocked;
  }
}
