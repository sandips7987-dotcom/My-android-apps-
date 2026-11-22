/**
 * VoxSynth DD-6 — QR Payment & Pro License Activation Modal (paywall.js)
 */

export class PaywallModal {
  constructor(licenseManager, onStatusChange, onToast) {
    this.license = licenseManager;
    this.onStatusChange = onStatusChange || (() => {});
    this.onToast = onToast || (() => {});

    this.modal = document.getElementById('pro-paywall-modal');
    this.deviceIdEl = document.getElementById('pro-device-id-text');
    this.copyBtn = document.getElementById('pro-copy-id-btn');
    this.keyInput = document.getElementById('pro-key-input');
    this.activateBtn = document.getElementById('pro-activate-btn');
    this.statusBanner = document.getElementById('pro-license-status');
    this.qrCanvas = document.getElementById('pro-qr-canvas');

    this._bindEvents();
  }

  _bindEvents() {
    if (this.copyBtn) {
      this.copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.license.deviceId);
          this.onToast('Device ID copied to clipboard.');
        } catch (_) {
          this.onToast(`Device ID: ${this.license.deviceId}`);
        }
      });
    }

    if (this.activateBtn) {
      this.activateBtn.addEventListener('click', async () => {
        const key = this.keyInput?.value || '';
        const res = await this.license.activate(key);
        this.onToast(res.message);
        this.refreshUI();
        if (res.ok) {
          this.onStatusChange(true);
        }
      });
    }
  }

  open() {
    this.refreshUI();
    if (this.modal) this.modal.classList.remove('hidden');
  }

  close() {
    if (this.modal) this.modal.classList.add('hidden');
  }

  refreshUI() {
    if (this.deviceIdEl) {
      this.deviceIdEl.textContent = this.license.deviceId;
    }
    this._renderPaymentQR(`upi://pay?pa=voxsynth@studio&pn=VoxSynth%20DD-6%20Pro&tn=${encodeURIComponent(this.license.deviceId)}&am=499&cu=INR`);

    if (this.statusBanner) {
      if (this.license.isPro()) {
        this.statusBanner.textContent = `PRO LICENSE ACTIVE (${this.license.activeKey})`;
        this.statusBanner.style.color = '#34d399';
      } else {
        this.statusBanner.textContent = 'STANDARD EDITION — Enter Offline Activation Key to Unlock Pro';
        this.statusBanner.style.color = '#94a3b8';
      }
    }
  }

  /**
   * Renders a crisp deterministic 25x25 QR-style payment visual with finder patterns
   * seeded by the Device ID payment URI (zero external image requests).
   */
  _renderPaymentQR(payload) {
    if (!this.qrCanvas) return;
    const ctx = this.qrCanvas.getContext('2d');
    const size = 25;
    const scale = 6;
    this.qrCanvas.width = size * scale;
    this.qrCanvas.height = size * scale;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, this.qrCanvas.width, this.qrCanvas.height);

    const matrix = Array.from({ length: size }, () => Array(size).fill(0));

    const drawFinder = (r0, c0) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const border = r === 0 || r === 6 || c === 0 || c === 6;
          const center = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          matrix[r0 + r][c0 + c] = border || center ? 1 : 0;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Deterministic data bits from payload hash
    let seed = 2166136261;
    for (let i = 0; i < payload.length; i++) {
      seed ^= payload.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        const inTopLeft = r < 8 && c < 8;
        const inTopRight = r < 8 && c >= size - 8;
        const inBotLeft = r >= size - 8 && c < 8;
        if (inTopLeft || inTopRight || inBotLeft) continue;
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        matrix[r][c] = (seed >>> 24) & 1;
      }
    }

    ctx.fillStyle = '#0b101b';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) {
          ctx.fillRect(c * scale, r * scale, scale, scale);
        }
      }
    }
  }
}
