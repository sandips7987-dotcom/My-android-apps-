/**
 * VoxSynth DD-6 — Tactile Hardware PIN Lock Screen & Settings UI (lockui.js)
 */

export class PinLockUI {
  constructor(pinManager, nativeBridge, onToast) {
    this.pinManager = pinManager;
    this.native = nativeBridge;
    this.onToast = onToast || (() => {});

    this.overlay = document.getElementById('pin-lock-overlay');
    this.dots = Array.from(document.querySelectorAll('#pin-lock-dots .pin-dot'));
    this.errorMsg = document.getElementById('pin-lock-error');
    this.entered = '';

    this.modal = document.getElementById('pin-settings-modal');
    this.statusEl = document.getElementById('pin-settings-status');
    this.newPinInput = document.getElementById('pin-new-input');
    this.saveBtn = document.getElementById('pin-save-btn');
    this.disableBtn = document.getElementById('pin-disable-btn');
    this.lockNowBtn = document.getElementById('pin-lock-now-btn');

    this._bindEvents();
  }

  _bindEvents() {
    document.querySelectorAll('#pin-keypad .pin-key').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-pin-key');
        this._handleKey(val);
      });
    });

    if (this.saveBtn) {
      this.saveBtn.addEventListener('click', async () => {
        const val = (this.newPinInput?.value || '').replace(/\D/g, '');
        if (val.length !== 4) {
          this.onToast('Enter a valid 4-digit PIN.');
          return;
        }
        await this.pinManager.setPin(val);
        if (this.newPinInput) this.newPinInput.value = '';
        this.refreshSettingsUI();
        this.onToast('4-Digit Startup PIN enabled.');
      });
    }

    if (this.disableBtn) {
      this.disableBtn.addEventListener('click', () => {
        this.pinManager.disablePin();
        this.refreshSettingsUI();
        this.onToast('Startup PIN lock disabled.');
      });
    }

    if (this.lockNowBtn) {
      this.lockNowBtn.addEventListener('click', () => {
        if (!this.pinManager.isEnabled()) {
          this.onToast('Set a 4-digit PIN first.');
          return;
        }
        this.closeSettings();
        this.showLockScreen();
      });
    }
  }

  checkStartupLock() {
    if (this.pinManager.isEnabled()) {
      this.showLockScreen();
    }
  }

  showLockScreen() {
    this.entered = '';
    this._renderDots(false);
    if (this.errorMsg) this.errorMsg.textContent = '';
    if (this.overlay) this.overlay.classList.remove('hidden');
  }

  hideLockScreen() {
    if (this.overlay) this.overlay.classList.add('hidden');
    this.entered = '';
    this._renderDots(false);
  }

  openSettings() {
    this.refreshSettingsUI();
    if (this.modal) this.modal.classList.remove('hidden');
  }

  closeSettings() {
    if (this.modal) this.modal.classList.add('hidden');
  }

  refreshSettingsUI() {
    const enabled = this.pinManager.isEnabled();
    if (this.statusEl) {
      this.statusEl.textContent = enabled
        ? 'Startup PIN Lock is ENABLED'
        : 'Startup PIN Lock is DISABLED';
      this.statusEl.style.color = enabled ? '#34d399' : '#94a3b8';
    }
    if (this.disableBtn) this.disableBtn.disabled = !enabled;
    if (this.lockNowBtn) this.lockNowBtn.disabled = !enabled;
  }

  async _handleKey(key) {
    if (this.native) this.native.hapticTap('light');

    if (key === 'clear') {
      this.entered = '';
      this._renderDots(false);
      return;
    }

    if (key === 'back') {
      this.entered = this.entered.slice(0, -1);
      this._renderDots(false);
      return;
    }

    if (this.entered.length >= 4) return;
    this.entered += key;
    this._renderDots(false);

    if (this.entered.length === 4) {
      const ok = await this.pinManager.verifyPin(this.entered);
      if (ok) {
        if (this.native) this.native.hapticTap('medium');
        this.hideLockScreen();
      } else {
        this._renderDots(true);
        if (this.errorMsg) this.errorMsg.textContent = 'Incorrect PIN — Try Again';
        setTimeout(() => {
          this.entered = '';
          this._renderDots(false);
        }, 420);
      }
    }
  }

  _renderDots(isError) {
    this.dots.forEach((dot, idx) => {
      dot.classList.toggle('filled', idx < this.entered.length && !isError);
      dot.classList.toggle('error', isError);
    });
  }
}
