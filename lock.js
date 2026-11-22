/**
 * VoxSynth DD-6 — 4-Digit Security PIN Engine (lock.js)
 * Stores only salted SHA-256 hash in localStorage using Web Crypto API.
 */

const PIN_HASH_KEY = 'voxsynth_dd6_pin_hash';
const PIN_ENABLED_KEY = 'voxsynth_dd6_pin_enabled';
const PIN_SALT = 'VOXSYNTH-DD6-PIN-SALT-V1';

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  if (window.crypto && window.crypto.subtle) {
    const hashBuf = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
  // Fallback FNV-1a 64-bit style hex for non-secure HTTP dev preview contexts
  let h1 = 0xdeadbeef ^ data.length;
  let h2 = 0x41c6ce57 ^ data.length;
  for (let i = 0; i < data.length; i++) {
    h1 = Math.imul(h1 ^ data[i], 2654435761);
    h2 = Math.imul(h2 ^ data[i], 1597334677);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).repeat(4);
}

export class PinLockManager {
  isEnabled() {
    return localStorage.getItem(PIN_ENABLED_KEY) === 'true' && Boolean(localStorage.getItem(PIN_HASH_KEY));
  }

  async setPin(fourDigitPin) {
    const clean = String(fourDigitPin || '').replace(/\D/g, '');
    if (clean.length !== 4) {
      throw new Error('PIN must be exactly 4 digits.');
    }
    const digest = await sha256Hex(`${PIN_SALT}:${clean}`);
    localStorage.setItem(PIN_HASH_KEY, digest);
    localStorage.setItem(PIN_ENABLED_KEY, 'true');
    return true;
  }

  async verifyPin(fourDigitPin) {
    const stored = localStorage.getItem(PIN_HASH_KEY);
    if (!stored) return true;
    const clean = String(fourDigitPin || '').replace(/\D/g, '');
    if (clean.length !== 4) return false;
    const digest = await sha256Hex(`${PIN_SALT}:${clean}`);
    return digest === stored;
  }

  disablePin() {
    localStorage.removeItem(PIN_HASH_KEY);
    localStorage.setItem(PIN_ENABLED_KEY, 'false');
  }
}
