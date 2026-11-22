/**
 * VoxSynth DD-6 — Dual Audio I/O & Hardware Routing Engine (audio-router.js)
 * Supports 3.5mm Wired (Ultra-Low Latency) and Bluetooth (BT Sync & Anti-Feedback)
 * Live hardware detection via navigator.mediaDevices.ondevicechange & setSinkId.
 */

export class AudioRouter {
  constructor() {
    this.mode = 'wired'; // 'wired' | 'bluetooth'
    this.btSyncOffsetMs = 110; // 0..250ms compensation in Bluetooth mode
    this.btMicSource = 'phone'; // 'phone' (Built-in Mic + BT A2DP) | 'bt' (Bluetooth Mic)
    this.btAntiFeedback = true;

    this.selectedInputId = '';
    this.selectedOutputId = '';

    this.inputs = [];
    this.outputs = [];
    this.detectedHardware = 'PHONE SPEAKER';

    this._listeners = new Set();
    this._audioContext = null;
    this._outputAudioEl = null;

    if (navigator.mediaDevices && typeof navigator.mediaDevices.addEventListener === 'function') {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        this.refreshDevices();
      });
    }
  }

  onChange(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _emit(eventType = 'update') {
    const state = this.getState();
    this._listeners.forEach((cb) => {
      try {
        cb(state, eventType);
      } catch (err) {
        console.error('[AudioRouter] listener error:', err);
      }
    });
  }

  getState() {
    return {
      mode: this.mode,
      btSyncOffsetMs: this.btSyncOffsetMs,
      btMicSource: this.btMicSource,
      btAntiFeedback: this.btAntiFeedback,
      selectedInputId: this.selectedInputId,
      selectedOutputId: this.selectedOutputId,
      inputs: this.inputs,
      outputs: this.outputs,
      detectedHardware: this.detectedHardware,
      sinkSupported: this.isSinkSelectionSupported(),
      effectiveSyncOffsetMs: this.mode === 'bluetooth' ? this.btSyncOffsetMs : 0,
    };
  }

  isSinkSelectionSupported() {
    const hasCtxSink = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
    const hasElSink = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
    return hasCtxSink || hasElSink;
  }

  attachAudioContext(ctx) {
    this._audioContext = ctx;
    if (this.selectedOutputId) {
      this.applyOutputSink(this.selectedOutputId);
    }
  }

  createAudioContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const latencyHint = this.mode === 'wired' ? 'interactive' : 'playback';
    const ctx = new AudioCtx({
      latencyHint,
      sampleRate: 48000,
    });
    this._audioContext = ctx;
    if (this.selectedOutputId) {
      this.applyOutputSink(this.selectedOutputId);
    }
    return ctx;
  }

  async refreshDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      this.detectedHardware = this.mode === 'bluetooth' ? 'BLUETOOTH' : '3.5MM WIRED';
      this._emit('devices');
      return this.getState();
    }

    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.inputs = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone ${idx + 1}`,
          groupId: d.groupId,
        }));

      this.outputs = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Audio Output ${idx + 1}`,
          groupId: d.groupId,
        }));

      this.detectedHardware = this._classifyHardware(this.inputs, this.outputs);

      if (!this.selectedInputId && this.inputs.length > 0) {
        this.selectedInputId = this._pickPreferredInputId();
      }
      if (!this.selectedOutputId && this.outputs.length > 0) {
        this.selectedOutputId = this._pickPreferredOutputId();
      }
    } catch (err) {
      console.warn('[AudioRouter] enumerateDevices warning:', err);
    }

    this._emit('devices');
    return this.getState();
  }

  _classifyHardware(inputs, outputs) {
    const activeOut =
      outputs.find((d) => d.deviceId === this.selectedOutputId) ||
      outputs.find((d) => d.deviceId === 'default') ||
      outputs[0];
    const activeIn =
      inputs.find((d) => d.deviceId === this.selectedInputId) ||
      inputs.find((d) => d.deviceId === 'default') ||
      inputs[0];

    const combined = `${activeOut?.label || ''} ${activeIn?.label || ''}`.toLowerCase();

    if (/bluetooth|bt\b|airpods|buds|tws|a2dp|hands-free|neckband|jbl|sony wh|bose|wireless/.test(combined)) {
      return 'BLUETOOTH';
    }
    if (/usb|otg|scarlett|focusrite|behringer|steinberg|audio interface|dac|type-c/.test(combined)) {
      return 'USB OTG';
    }
    if (/headset|headphone|earphone|wired|3\.5|aux|line out|external|jack/.test(combined)) {
      return '3.5MM WIRED';
    }
    if (this.mode === 'bluetooth') {
      return 'BLUETOOTH';
    }
    if (outputs.length > 1 || inputs.length > 1) {
      return this.mode === 'wired' ? '3.5MM WIRED' : 'PHONE SPEAKER';
    }
    return 'PHONE SPEAKER';
  }

  _isBluetoothLabel(label = '') {
    return /bluetooth|bt\b|airpods|buds|tws|a2dp|hands-free|neckband|wireless/i.test(label);
  }

  _isBuiltInPhoneMic(label = '') {
    return /built-in|internal|phone|bottom|primary|microphone array|default/i.test(label) && !this._isBluetoothLabel(label);
  }

  _pickPreferredInputId() {
    if (!this.inputs.length) return '';

    if (this.mode === 'bluetooth') {
      if (this.btMicSource === 'phone') {
        const phoneMic = this.inputs.find((d) => this._isBuiltInPhoneMic(d.label));
        if (phoneMic) return phoneMic.deviceId;
        const nonBt = this.inputs.find((d) => !this._isBluetoothLabel(d.label));
        if (nonBt) return nonBt.deviceId;
      } else {
        const btMic = this.inputs.find((d) => this._isBluetoothLabel(d.label));
        if (btMic) return btMic.deviceId;
      }
    } else {
      const wiredMic = this.inputs.find((d) => /headset|wired|3\.5|aux|usb/i.test(d.label));
      if (wiredMic) return wiredMic.deviceId;
    }

    return this.inputs[0].deviceId;
  }

  _pickPreferredOutputId() {
    if (!this.outputs.length) return '';

    if (this.mode === 'bluetooth') {
      const btOut = this.outputs.find((d) => this._isBluetoothLabel(d.label));
      if (btOut) return btOut.deviceId;
    } else {
      const wiredOut = this.outputs.find((d) => /headphone|headset|wired|3\.5|aux|line|usb/i.test(d.label));
      if (wiredOut) return wiredOut.deviceId;
    }
    return this.outputs[0].deviceId;
  }

  setMode(newMode) {
    const normalized = newMode === 'bluetooth' ? 'bluetooth' : 'wired';
    if (this.mode === normalized) return this.getState();
    this.mode = normalized;

    this.selectedInputId = this._pickPreferredInputId() || this.selectedInputId;
    this.selectedOutputId = this._pickPreferredOutputId() || this.selectedOutputId;
    this.detectedHardware = this._classifyHardware(this.inputs, this.outputs);

    if (this.selectedOutputId) {
      this.applyOutputSink(this.selectedOutputId);
    }

    this._emit('mode');
    return this.getState();
  }

  toggleMode() {
    return this.setMode(this.mode === 'wired' ? 'bluetooth' : 'wired');
  }

  setBtSyncOffset(ms) {
    const clamped = Math.max(0, Math.min(250, Math.round(Number(ms) || 0)));
    this.btSyncOffsetMs = clamped;
    this._emit('sync');
    return clamped;
  }

  setBtMicSource(source) {
    this.btMicSource = source === 'bt' ? 'bt' : 'phone';
    if (this.mode === 'bluetooth') {
      const preferred = this._pickPreferredInputId();
      if (preferred) this.selectedInputId = preferred;
    }
    this._emit('mic-source');
  }

  setBtAntiFeedback(enabled) {
    this.btAntiFeedback = Boolean(enabled);
    this._emit('anti-feedback');
  }

  setInputDevice(deviceId) {
    this.selectedInputId = deviceId || '';
    this.detectedHardware = this._classifyHardware(this.inputs, this.outputs);
    this._emit('input');
  }

  async setOutputDevice(deviceId) {
    this.selectedOutputId = deviceId || '';
    this.detectedHardware = this._classifyHardware(this.inputs, this.outputs);
    await this.applyOutputSink(this.selectedOutputId);
    this._emit('output');
  }

  async applyOutputSink(deviceId) {
    if (!deviceId) return false;
    try {
      if (this._audioContext && typeof this._audioContext.setSinkId === 'function') {
        await this._audioContext.setSinkId(deviceId);
        return true;
      }
      if (this._outputAudioEl && typeof this._outputAudioEl.setSinkId === 'function') {
        await this._outputAudioEl.setSinkId(deviceId);
        return true;
      }
    } catch (err) {
      console.warn('[AudioRouter] setSinkId failed:', err.message);
    }
    return false;
  }

  getMicConstraints(overrideRaw = null) {
    const isWired = this.mode === 'wired';
    const useAntiFeedback = !isWired && this.btAntiFeedback;
    const rawStudio = overrideRaw !== null ? overrideRaw : isWired || !useAntiFeedback;

    const audio = {
      echoCancellation: !rawStudio,
      noiseSuppression: !rawStudio,
      autoGainControl: false,
      channelCount: 1,
      sampleRate: 48000,
    };

    if (this.selectedInputId && this.selectedInputId !== 'default') {
      audio.deviceId = { ideal: this.selectedInputId };
    }

    return { audio, video: false };
  }
}
