/**
 * VoxSynth DD-6 — Main Hardware Controller & Application Entry (app.js)
 * Wires tactile rotary knobs, illuminated buttons, metallic stomp pedal,
 * Studio OLED display, Audio I/O Router, Backing Track Deck, Master Recorder,
 * IndexedDB Library, Themes, Multi-Language (EN/HI/AR), PIN Lock, and Pro Licensing.
 */

import { AudioRouter } from './audio-router.js';
import { VoiceProcessor } from './voice-processor.js';
import { DD6Engine, DD6_MODES } from './engine.js';
import { StudioDisplay } from './display.js';
import { BackingTrackDeck, formatTimeMMSS } from './track-player.js';
import { MasterMediaLibrary } from './media.js';
import { ThemeManager, VOXSYNTH_THEMES } from './themes.js';
import { I18nManager } from './i18n.js';
import { PinLockManager } from './lock.js';
import { PinLockUI } from './lockui.js';
import { LicenseManager } from './license.js';
import { PaywallModal } from './paywall.js';
import { NativeBridge } from './native.js';

class VoxSynthApp {
  constructor() {
    this.native = new NativeBridge();
    this.router = new AudioRouter();
    this.i18n = new I18nManager(() => this._onLanguageChanged());
    this.pinManager = new PinLockManager();
    this.license = new LicenseManager();

    this.ctx = null;
    this.voice = null;
    this.engine = null;
    this.deck = null;
    this.media = null;

    this.display = new StudioDisplay();
    this.knobs = new Map();
    this._tempoLedTimer = null;
    this._renamingId = null;

    this.themeManager = new ThemeManager((theme) => {
      this.display.refreshThemePalette();
      this.native.setStatusBarColor(theme.statusBarColor, false);
      this._renderThemeCards();
    });

    this.pinUI = new PinLockUI(this.pinManager, this.native, (msg) => this.toast(msg));
    this.paywall = new PaywallModal(
      this.license,
      () => this._refreshProButton(),
      (msg) => this.toast(msg)
    );
  }

  async init() {
    this.i18n.applyToDOM();
    this._updateLangButton();

    await this.license.init();
    this._refreshProButton();
    this.pinUI.checkStartupLock();

    // Pre-initialize UI controls and tactile knobs immediately (zero-latency UI)
    this._initKnobs();
    this._bindPedalControls();
    this._bindAudioRouterUI();
    this._bindBackingDeckUI();
    this._bindTopBarAndModals();
    this._renderThemeCards();

    // Initialize Web Audio DSP Graph on boot (resumes cleanly on first user tap)
    this._buildAudioGraph();
    await this.router.refreshDevices();
    this._renderAudioRouterState(this.router.getState());
    this.display.start();
    this._startCheckLedTempoPulse();
    await this._refreshRecordingsList();

    // Keep screen awake on live stage once user interacts
    const unlockOnce = async () => {
      await this._ensureAudioReady();
      this.native.enableKeepAwake();
      window.removeEventListener('pointerdown', unlockOnce);
      window.removeEventListener('keydown', unlockOnce);
    };
    window.addEventListener('pointerdown', unlockOnce, { passive: true });
    window.addEventListener('keydown', unlockOnce);
  }

  _buildAudioGraph() {
    if (this.ctx) {
      try {
        this.voice?.destroy();
        this.engine?.destroy();
        this.deck?.destroy();
        this.ctx.close();
      } catch (_) {}
    }

    this.ctx = this.router.createAudioContext();
    this.voice = new VoiceProcessor(this.ctx, this.router);
    this.engine = new DD6Engine(this.ctx);
    this.deck = new BackingTrackDeck(this.ctx, this.engine);
    this.media = new MasterMediaLibrary(this.ctx, this.engine.masterOutput);

    // Connect Voice Preamp + Reverb output -> DD-6 Delay Engine input
    this.voice.outputNode.connect(this.engine.fxInput);

    // Connect Analysers to 60fps Studio OLED Display
    this.display.attachAnalysers(this.voice.inputAnalyser, this.engine.outputAnalyser);

    // Bind callbacks
    this.engine.onHoldStateChange(() => this._syncPedalUI());
    this.deck.onUpdate((state) => this._renderDeckState(state));
    this.media.onStatusChange((status) => this._renderRecorderStatus(status));

    // Apply current Bluetooth sync offset
    const routerState = this.router.getState();
    this.engine.setBtSyncOffsetMs(routerState.effectiveSyncOffsetMs);

    // Sync knob values into freshly built graph
    this._pushAllKnobsToAudio();
    this._syncPedalUI();
  }

  async _ensureAudioReady() {
    if (!this.ctx) this._buildAudioGraph();
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (_) {}
    }
  }

  /**
   * Rebuilds AudioContext with appropriate latencyHint when switching between
   * 3.5mm Wired ('interactive') and Bluetooth ('playback'), preserving live mic & knobs.
   */
  async _applyAudioRouterMode(newMode) {
    const wasMicLive = Boolean(this.voice?.micLive);
    const savedState = {
      active: this.engine?.active ?? true,
      modeIndex: this.engine?.modeIndex ?? 1,
      delayMs: this.engine?.delayMs ?? 420,
      effectLevel: this.engine?.effectLevel ?? 58,
      feedback: this.engine?.feedback ?? 46,
      pingPong: this.engine?.pingPong ?? false,
      routeToFx: this.deck?.routeToFx ?? false,
      deckVol: this.deck?.volume ?? 0.75,
      deckLoop: this.deck?.isLooping ?? true,
    };

    const state = this.router.setMode(newMode);
    this._buildAudioGraph();

    this.engine.setActive(savedState.active);
    this.engine.setModeIndex(savedState.modeIndex);
    this.engine.setDelayMs(savedState.delayMs);
    this.engine.setEffectLevel(savedState.effectLevel);
    this.engine.setFeedback(savedState.feedback);
    this.engine.setPingPong(savedState.pingPong);
    this.engine.setBtSyncOffsetMs(state.effectiveSyncOffsetMs);
    this.deck.setRouteToFx(savedState.routeToFx);
    this.deck.setVolume(savedState.deckVol);
    this.deck.setLoop(savedState.deckLoop);

    if (wasMicLive) {
      try {
        await this.voice.enableMicrophone();
      } catch (err) {
        this.toast(`Mic switch warning: ${err.message}`);
      }
    }

    this._renderAudioRouterState(this.router.getState());
    this._syncPedalUI();
    this.native.hapticTap('medium');
    this.toast(
      newMode === 'bluetooth'
        ? 'Bluetooth Mode Active — BT Sync & Anti-Feedback ready'
        : '3.5mm Wired Mode Active — Ultra-Low Latency engaged'
    );
  }

  /* ========================================================================
     Tactile Rotary Knobs Engine (Mouse, Touch Drag, Wheel, Keyboard, Double-Tap)
     ======================================================================== */
  _initKnobs() {
    const specs = [
      {
        id: 'elevel',
        min: 0,
        max: 100,
        value: 58,
        defaultVal: 58,
        step: 1,
        format: (v) => `${Math.round(v)}%`,
        onChange: (v) => this.engine?.setEffectLevel(v),
      },
      {
        id: 'fback',
        min: 0,
        max: 98,
        value: 46,
        defaultVal: 46,
        step: 1,
        format: (v) => `${Math.round(v)}%`,
        onChange: (v) => this.engine?.setFeedback(v),
      },
      {
        id: 'dtime',
        min: 50,
        max: 3200,
        value: 420,
        defaultVal: 420,
        step: 1,
        logarithmic: true,
        format: (v) => `${Math.round(v)}ms`,
        onChange: (v) => {
          if (!this.engine) return;
          const mode = this.engine.getModeObj();
          // Map knob sweep smoothly within active S / M / L / WARP range, or full 50..3200 in CUSTOM/HOLD
          const norm = this._valueToNorm(v, 50, 3200, true);
          const mappedMs = Math.round(mode.minMs * Math.pow(mode.maxMs / mode.minMs, norm));
          this.engine.setDelayMs(mappedMs);
          this._syncPedalUI();
        },
      },
      {
        id: 'mode',
        min: 0,
        max: 5,
        value: 1,
        defaultVal: 1,
        step: 1,
        discrete: true,
        format: (v) => DD6_MODES[Math.round(v)]?.id || 'M',
        onChange: (v) => {
          if (!this.engine) return;
          const prev = this.engine.modeIndex;
          const idx = Math.round(v);
          if (idx !== prev) {
            this.native.hapticTap('light');
          }
          this.engine.setModeIndex(idx);
          this._syncDTimeKnobFromEngine();
          this._syncPedalUI();
        },
      },
      {
        id: 'micgain',
        min: 0,
        max: 24,
        value: 6,
        defaultVal: 6,
        step: 0.5,
        format: (v) => `+${Number(v).toFixed(1)}dB`,
        onChange: (v) => this.voice?.setMicGainDb(v),
      },
      {
        id: 'gate',
        min: 0,
        max: 100,
        value: 22,
        defaultVal: 22,
        step: 1,
        format: (v) => `${Math.round(v)}%`,
        onChange: (v) => this.voice?.setGate(v),
      },
      {
        id: 'tone',
        min: 0,
        max: 100,
        value: 56,
        defaultVal: 56,
        step: 1,
        format: (v) => (v < 45 ? 'WARM' : v > 58 ? 'CRISP' : 'FLAT'),
        onChange: (v) => this.voice?.setTone(v),
      },
      {
        id: 'reverb',
        min: 0,
        max: 100,
        value: 24,
        defaultVal: 24,
        step: 1,
        format: (v) => `${Math.round(v)}%`,
        onChange: (v) => this.voice?.setReverb(v),
      },
    ];

    specs.forEach((spec) => {
      const wrap = document.querySelector(`[data-knob="${spec.id}"]`);
      if (!wrap) return;
      const cap = wrap.querySelector('.knob-cap');
      const readout = document.getElementById(`readout-${spec.id}`);
      const knobState = { ...spec, wrap, cap, readout };
      this.knobs.set(spec.id, knobState);

      this._drawKnobTicks(wrap, spec.discrete ? 6 : 11);
      this._renderKnobVisual(knobState);

      let startY = 0;
      let startNorm = 0;
      let dragging = false;

      const onPointerDown = (e) => {
        e.preventDefault();
        this._ensureAudioReady();
        dragging = true;
        startY = e.clientY;
        startNorm = this._valueToNorm(knobState.value, knobState.min, knobState.max, knobState.logarithmic);
        wrap.classList.add('dragging');
        wrap.setPointerCapture(e.pointerId);
      };

      const onPointerMove = (e) => {
        if (!dragging) return;
        const deltaY = startY - e.clientY;
        const sensitivity = knobState.discrete ? 160 : 190;
        const nextNorm = Math.max(0, Math.min(1, startNorm + deltaY / sensitivity));
        const nextVal = this._normToValue(nextNorm, knobState.min, knobState.max, knobState.step, knobState.logarithmic);
        this._setKnobValue(spec.id, nextVal, true);
      };

      const onPointerUp = (e) => {
        if (!dragging) return;
        dragging = false;
        wrap.classList.remove('dragging');
        try {
          wrap.releasePointerCapture(e.pointerId);
        } catch (_) {}
      };

      wrap.addEventListener('pointerdown', onPointerDown);
      wrap.addEventListener('pointermove', onPointerMove);
      wrap.addEventListener('pointerup', onPointerUp);
      wrap.addEventListener('pointercancel', onPointerUp);

      wrap.addEventListener(
        'wheel',
        (e) => {
          e.preventDefault();
          const dir = e.deltaY < 0 ? 1 : -1;
          const stepNorm = knobState.discrete ? 1 / 5 : 0.025;
          const curNorm = this._valueToNorm(knobState.value, knobState.min, knobState.max, knobState.logarithmic);
          const nextNorm = Math.max(0, Math.min(1, curNorm + dir * stepNorm));
          const nextVal = this._normToValue(nextNorm, knobState.min, knobState.max, knobState.step, knobState.logarithmic);
          this._setKnobValue(spec.id, nextVal, true);
        },
        { passive: false }
      );

      wrap.addEventListener('dblclick', () => {
        this._setKnobValue(spec.id, knobState.defaultVal, true);
        this.native.hapticTap('light');
      });

      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          e.preventDefault();
          const inc = knobState.discrete ? 1 : Math.max(knobState.step, (knobState.max - knobState.min) * 0.03);
          this._setKnobValue(spec.id, Math.min(knobState.max, knobState.value + inc), true);
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const dec = knobState.discrete ? 1 : Math.max(knobState.step, (knobState.max - knobState.min) * 0.03);
          this._setKnobValue(spec.id, Math.max(knobState.min, knobState.value - dec), true);
        }
      });
    });
  }

  _drawKnobTicks(wrap, count) {
    const svg = wrap.querySelector('.knob-scale-svg');
    if (!svg) return;
    svg.innerHTML = '';
    const cx = 50;
    const cy = 50;
    const rOuter = 47;
    const rInner = 41;

    for (let i = 0; i < count; i++) {
      const norm = count === 1 ? 0.5 : i / (count - 1);
      const deg = -135 + norm * 270 - 90;
      const rad = (deg * Math.PI) / 180;
      const x1 = cx + Math.cos(rad) * rInner;
      const y1 = cy + Math.sin(rad) * rInner;
      const x2 = cx + Math.cos(rad) * rOuter;
      const y2 = cy + Math.sin(rad) * rOuter;

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', x1.toFixed(1));
      line.setAttribute('y1', y1.toFixed(1));
      line.setAttribute('x2', x2.toFixed(1));
      line.setAttribute('y2', y2.toFixed(1));
      line.setAttribute('stroke', 'var(--knob-tick)');
      line.setAttribute('stroke-width', count === 6 ? '3.2' : '2.2');
      line.setAttribute('stroke-linecap', 'round');
      svg.appendChild(line);
    }
  }

  _valueToNorm(val, min, max, logarithmic = false) {
    const clamped = Math.max(min, Math.min(max, val));
    if (logarithmic && min > 0) {
      return Math.log(clamped / min) / Math.log(max / min);
    }
    return (clamped - min) / (max - min);
  }

  _normToValue(norm, min, max, step = 1, logarithmic = false) {
    const n = Math.max(0, Math.min(1, norm));
    let raw;
    if (logarithmic && min > 0) {
      raw = min * Math.pow(max / min, n);
    } else {
      raw = min + n * (max - min);
    }
    return Math.round(raw / step) * step;
  }

  _setKnobValue(id, value, triggerAudio = true) {
    const k = this.knobs.get(id);
    if (!k) return;
    k.value = Math.max(k.min, Math.min(k.max, value));
    this._renderKnobVisual(k);
    if (triggerAudio && k.onChange) {
      k.onChange(k.value);
    }
  }

  _renderKnobVisual(k) {
    const norm = this._valueToNorm(k.value, k.min, k.max, k.logarithmic);
    const angle = -135 + norm * 270;
    if (k.cap) {
      k.cap.style.transform = `rotate(${angle.toFixed(1)}deg)`;
    }
    if (k.readout) {
      if (k.id === 'dtime' && this.engine) {
        k.readout.textContent = `${Math.round(this.engine.delayMs)}ms`;
      } else {
        k.readout.textContent = k.format(k.value);
      }
    }
    k.wrap.setAttribute('aria-valuenow', String(Math.round(k.value)));
  }

  _syncDTimeKnobFromEngine() {
    if (!this.engine) return;
    const k = this.knobs.get('dtime');
    if (!k) return;
    const mode = this.engine.getModeObj();
    const normInMode = this._valueToNorm(this.engine.delayMs, mode.minMs, mode.maxMs, true);
    k.value = this._normToValue(normInMode, 50, 3200, 1, true);
    this._renderKnobVisual(k);
  }

  _pushAllKnobsToAudio() {
    this.knobs.forEach((k) => {
      if (k.id !== 'dtime' && k.onChange) {
        k.onChange(k.value);
      }
    });
    if (this.engine) {
      this.engine.setDelayMs(this.engine.delayMs);
    }
  }

  /* ========================================================================
     Pedal Buttons, Fine-Tune Milliseconds, Footswitch & Recorder Transport
     ======================================================================== */
  _bindPedalControls() {
    // Direct Millisecond Numeric Input
    const msInput = document.getElementById('oled-ms-input');
    if (msInput) {
      const commitMs = () => {
        if (!this.engine) return;
        const val = parseInt(msInput.value, 10);
        if (!Number.isNaN(val)) {
          this.engine.setDelayMs(val);
          this._syncDTimeKnobFromEngine();
          this._syncPedalUI();
        }
      };
      msInput.addEventListener('change', commitMs);
      msInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          commitMs();
          msInput.blur();
        }
      });
    }

    // Fine-Tune Buttons (-10ms, -1ms, +1ms, +10ms)
    document.querySelectorAll('[data-ms-delta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this._ensureAudioReady();
        const delta = Number(btn.getAttribute('data-ms-delta')) || 0;
        this.engine.nudgeDelayMs(delta);
        this._syncDTimeKnobFromEngine();
        this._syncPedalUI();
        this.native.hapticTap('light');
      });
    });

    // Oscilloscope / Spectrum Mode Toggle inside OLED
    const scopeBtn = document.getElementById('viz-scope-btn');
    const specBtn = document.getElementById('viz-spec-btn');
    if (scopeBtn && specBtn) {
      scopeBtn.addEventListener('click', () => {
        this.display.setVizMode('scope');
        scopeBtn.classList.add('active');
        specBtn.classList.remove('active');
      });
      specBtn.addEventListener('click', () => {
        this.display.setVizMode('spectrum');
        specBtn.classList.add('active');
        scopeBtn.classList.remove('active');
      });
    }

    // Main Metallic BYPASS / EFFECT Stomp Pedal
    const stompBtn = document.getElementById('stomp-pedal-btn');
    if (stompBtn) {
      stompBtn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        this.engine.toggleBypass();
        this.native.hapticTap('heavy');
        this._syncPedalUI();
      });
    }

    // TAP TEMPO Button
    const tapBtn = document.getElementById('btn-tap-tempo');
    if (tapBtn) {
      tapBtn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        this.engine.tapTempo();
        this._syncDTimeKnobFromEngine();
        this._syncPedalUI();
        this.native.hapticTap('light');

        tapBtn.classList.add('lit-blue');
        setTimeout(() => tapBtn.classList.remove('lit-blue'), 160);
      });
    }

    // MIC LIVE ON/OFF Button
    const micBtn = document.getElementById('btn-mic-live');
    if (micBtn) {
      micBtn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        try {
          const isLive = await this.voice.toggleMicrophone();
          this.native.hapticTap('medium');
          this._syncPedalUI();
          this._renderAudioRouterState(this.router.getState());
          this.toast(isLive ? 'Microphone Live — Studio Preamp Engaged' : 'Microphone Muted');
        } catch (err) {
          this.toast(`Mic permission needed: ${err.message}`);
        }
      });
    }

    // Quick Pedal AUDIO ROUTE (3.5mm / BT) Toggle Button
    const routeBtn = document.getElementById('btn-audio-route');
    if (routeBtn) {
      routeBtn.addEventListener('click', async () => {
        const nextMode = this.router.mode === 'wired' ? 'bluetooth' : 'wired';
        await this._applyAudioRouterMode(nextMode);
      });
    }

    // STEREO PING-PONG Toggle Button
    const ppBtn = document.getElementById('btn-ping-pong');
    if (ppBtn) {
      ppBtn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        this.engine.setPingPong(!this.engine.pingPong);
        this.native.hapticTap('light');
        this._syncPedalUI();
      });
    }

    // Master Recorder Transport: REC, PAUSE, STOP + Vocal Audition Synth
    const recBtn = document.getElementById('btn-master-rec');
    const pauseBtn = document.getElementById('btn-master-pause');
    const stopBtn = document.getElementById('btn-master-stop');
    const testBtn = document.getElementById('btn-audition-synth');

    if (recBtn) {
      recBtn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        await this.media.startRecording();
        this.native.hapticTap('medium');
        this.toast('Master Bus Recording Started');
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        const paused = this.media.togglePause();
        this.toast(paused ? 'Recording Paused' : 'Recording Resumed');
      });
    }

    if (stopBtn) {
      stopBtn.addEventListener('click', async () => {
        const saved = await this.media.stopAndSave({
          delayMs: this.engine?.delayMs,
          mode: this.engine?.getModeObj().name,
        });
        if (saved) {
          this.native.hapticTap('medium');
          await this._refreshRecordingsList();
          this.toast(`Saved "${saved.name}" to Library`);
        }
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        this.voice.triggerAuditionPhrase();
        this.native.hapticTap('light');
      });
    }
  }

  _syncPedalUI() {
    if (!this.engine) return;
    const mode = this.engine.getModeObj();

    this.display.updateReadout({
      delayMs: this.engine.delayMs,
      bpm: this.engine.getBpm(),
      modeName: mode.name,
      active: this.engine.active,
      holdState: this.engine.holdState,
    });

    const micLive = Boolean(this.voice?.micLive);
    this.display.updateMicStatus(micLive);

    const micBtn = document.getElementById('btn-mic-live');
    if (micBtn) {
      micBtn.classList.toggle('lit-green', micLive);
      micBtn.classList.toggle('lit-red', !micLive);
    }

    const ppBtn = document.getElementById('btn-ping-pong');
    if (ppBtn) {
      ppBtn.classList.toggle('lit-blue', this.engine.pingPong);
    }

    const routeBtn = document.getElementById('btn-audio-route');
    const routeLabel = document.getElementById('btn-audio-route-label');
    if (routeBtn && routeLabel) {
      const isBt = this.router.mode === 'bluetooth';
      routeBtn.classList.toggle('lit-blue', isBt);
      routeBtn.classList.toggle('lit-green', !isBt);
      routeLabel.textContent = isBt ? this.i18n.t('btn_route_bt') : this.i18n.t('btn_route_wired');
    }

    // Stomp Subtitle & CHECK LED state
    const stompSub = document.getElementById('stomp-subtitle');
    const checkLed = document.getElementById('check-led');

    if (mode.id === 'HOLD') {
      if (stompSub) {
        stompSub.textContent =
          this.engine.holdState === 'recording'
            ? this.i18n.t('stomp_sub_hold_rec')
            : this.engine.holdState === 'playing'
              ? this.i18n.t('stomp_sub_hold_play')
              : this.i18n.t('stomp_sub_hold_idle');
      }
      if (checkLed) {
        checkLed.classList.toggle('on-red', this.engine.holdState === 'recording');
        checkLed.classList.toggle('on-green', this.engine.holdState === 'playing');
      }
    } else {
      if (stompSub) {
        stompSub.textContent = this.engine.active
          ? this.i18n.t('stomp_sub_active')
          : this.i18n.t('stomp_sub_bypass');
      }
      if (checkLed) {
        checkLed.classList.toggle('on-red', this.engine.active);
        checkLed.classList.remove('on-green');
      }
    }

    this._syncDTimeKnobFromEngine();
  }

  _startCheckLedTempoPulse() {
    let lastBlink = 0;
    let lit = true;
    const step = (ts) => {
      const checkLed = document.getElementById('check-led');
      if (checkLed && this.engine && this.engine.active && this.engine.getModeObj().id !== 'HOLD') {
        const interval = Math.max(120, Math.min(1600, this.engine.delayMs));
        if (ts - lastBlink >= interval * 0.5) {
          lit = !lit;
          lastBlink = ts;
          checkLed.classList.toggle('pulse-dim', !lit);
        }
      } else if (checkLed) {
        checkLed.classList.remove('pulse-dim');
      }
      this._tempoLedTimer = requestAnimationFrame(step);
    };
    this._tempoLedTimer = requestAnimationFrame(step);
  }

  _renderRecorderStatus(status) {
    this.display.updateRecordingStatus(status.isRecording, status.isPaused, status.formatted);

    const recBtn = document.getElementById('btn-master-rec');
    const pauseBtn = document.getElementById('btn-master-pause');
    const stopBtn = document.getElementById('btn-master-stop');

    if (recBtn) recBtn.classList.toggle('rec-active', status.isRecording && !status.isPaused);
    if (pauseBtn) {
      pauseBtn.disabled = !status.isRecording;
      pauseBtn.classList.toggle('pause-active', status.isRecording && status.isPaused);
    }
    if (stopBtn) stopBtn.disabled = !status.isRecording;
  }

  /* ========================================================================
     Dual Audio I/O & Hardware Router UI (3.5mm Wired & Bluetooth)
     ======================================================================== */
  _bindAudioRouterUI() {
    this.router.onChange((state) => {
      this._renderAudioRouterState(state);
    });

    const wiredBtn = document.getElementById('io-mode-wired');
    const btBtn = document.getElementById('io-mode-bt');
    const inputSel = document.getElementById('io-input-select');
    const outputSel = document.getElementById('io-output-select');
    const btSyncRange = document.getElementById('bt-sync-slider');
    const btMicSel = document.getElementById('bt-mic-source-select');
    const antiFbToggle = document.getElementById('bt-antifb-toggle');
    const rescanBtn = document.getElementById('io-rescan-btn');

    if (wiredBtn) wiredBtn.addEventListener('click', () => this._applyAudioRouterMode('wired'));
    if (btBtn) btBtn.addEventListener('click', () => this._applyAudioRouterMode('bluetooth'));

    if (inputSel) {
      inputSel.addEventListener('change', async () => {
        this.router.setInputDevice(inputSel.value);
        if (this.voice?.micLive) {
          await this.voice.rebindMicrophoneIfLive();
          this.toast('Switched live microphone input.');
        }
      });
    }

    if (outputSel) {
      outputSel.addEventListener('change', async () => {
        await this.router.setOutputDevice(outputSel.value);
        this.toast('Audio output sink updated.');
      });
    }

    if (btSyncRange) {
      btSyncRange.addEventListener('input', () => {
        const ms = this.router.setBtSyncOffset(btSyncRange.value);
        if (this.engine && this.router.mode === 'bluetooth') {
          this.engine.setBtSyncOffsetMs(ms);
        }
      });
    }

    if (btMicSel) {
      btMicSel.addEventListener('change', async () => {
        this.router.setBtMicSource(btMicSel.value);
        if (this.voice?.micLive) {
          await this.voice.rebindMicrophoneIfLive();
        }
        this.toast(
          btMicSel.value === 'phone'
            ? 'Using Phone Built-in Mic + BT A2DP Stereo Output'
            : 'Using Bluetooth Headset Mic'
        );
      });
    }

    if (antiFbToggle) {
      antiFbToggle.addEventListener('click', async () => {
        const next = !this.router.btAntiFeedback;
        this.router.setBtAntiFeedback(next);
        if (this.voice?.micLive && this.router.mode === 'bluetooth') {
          await this.voice.rebindMicrophoneIfLive();
        }
      });
    }

    if (rescanBtn) {
      rescanBtn.addEventListener('click', async () => {
        await this.router.refreshDevices();
        this.toast(`Detected: ${this.router.detectedHardware}`);
      });
    }
  }

  _renderAudioRouterState(state) {
    this.display.updateHardwareBadge(state.detectedHardware);

    const badgeTop = document.getElementById('io-hardware-status');
    if (badgeTop) badgeTop.textContent = state.detectedHardware;

    const wiredBtn = document.getElementById('io-mode-wired');
    const btBtn = document.getElementById('io-mode-bt');
    if (wiredBtn) wiredBtn.classList.toggle('active', state.mode === 'wired');
    if (btBtn) btBtn.classList.toggle('active', state.mode === 'bluetooth');

    const btBlock = document.getElementById('bt-controls-block');
    if (btBlock) btBlock.classList.toggle('disabled-dim', state.mode !== 'bluetooth');

    const btSyncVal = document.getElementById('bt-sync-value');
    const btSyncSlider = document.getElementById('bt-sync-slider');
    if (btSyncVal) btSyncVal.textContent = `${state.btSyncOffsetMs}ms`;
    if (btSyncSlider) btSyncSlider.value = String(state.btSyncOffsetMs);

    const btMicSel = document.getElementById('bt-mic-source-select');
    if (btMicSel) btMicSel.value = state.btMicSource;

    const antiFbToggle = document.getElementById('bt-antifb-toggle');
    if (antiFbToggle) {
      antiFbToggle.classList.toggle('on', state.btAntiFeedback);
      antiFbToggle.setAttribute('aria-checked', String(state.btAntiFeedback));
    }

    // Populate Input / Output Dropdowns
    const inputSel = document.getElementById('io-input-select');
    if (inputSel) {
      inputSel.innerHTML = '';
      if (!state.inputs.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Default Studio Microphone';
        inputSel.appendChild(opt);
      } else {
        state.inputs.forEach((dev) => {
          const opt = document.createElement('option');
          opt.value = dev.deviceId;
          opt.textContent = dev.label;
          if (dev.deviceId === state.selectedInputId) opt.selected = true;
          inputSel.appendChild(opt);
        });
      }
    }

    const outputSel = document.getElementById('io-output-select');
    if (outputSel) {
      outputSel.innerHTML = '';
      if (!state.outputs.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = state.sinkSupported ? 'System Default Output' : 'System Output (OS Routed)';
        outputSel.appendChild(opt);
      } else {
        state.outputs.forEach((dev) => {
          const opt = document.createElement('option');
          opt.value = dev.deviceId;
          opt.textContent = dev.label;
          if (dev.deviceId === state.selectedOutputId) opt.selected = true;
          outputSel.appendChild(opt);
        });
      }
    }

    this._syncPedalUI();
  }

  /* ========================================================================
     Backing Track Upload & Overdub Deck UI
     ======================================================================== */
  _bindBackingDeckUI() {
    const fileInput = document.getElementById('track-file-input');
    const uploadBtn = document.getElementById('deck-upload-btn');
    const demoBtn = document.getElementById('deck-demo-btn');
    const playBtn = document.getElementById('deck-play-btn');
    const pauseBtn = document.getElementById('deck-pause-btn');
    const stopBtn = document.getElementById('deck-stop-btn');
    const loopBtn = document.getElementById('deck-loop-btn');
    const fxBtn = document.getElementById('deck-fx-btn');
    const seekBar = document.getElementById('deck-seek-bar');
    const volSlider = document.getElementById('deck-vol-slider');

    if (uploadBtn && fileInput) {
      uploadBtn.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', async () => {
        const file = fileInput.files?.[0];
        if (!file) return;
        await this._ensureAudioReady();
        try {
          await this.deck.loadFile(file);
          this.toast(`Loaded "${file.name}"`);
        } catch (err) {
          this.toast(`Could not decode audio: ${err.message}`);
        }
        fileInput.value = '';
      });
    }

    if (demoBtn) {
      demoBtn.addEventListener('click', async () => {
        await this._ensureAudioReady();
        this.deck.loadBuiltInStudioGroove();
        await this.deck.play();
        this.toast('Playing Built-in 100 BPM Studio Groove');
      });
    }

    if (playBtn) playBtn.addEventListener('click', () => this.deck.play());
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.deck.pause());
    if (stopBtn) stopBtn.addEventListener('click', () => this.deck.stop());

    if (loopBtn) {
      loopBtn.addEventListener('click', () => {
        const looping = this.deck.toggleLoop();
        this.toast(looping ? 'Backing Track Loop ON' : 'Backing Track Loop OFF');
      });
    }

    if (fxBtn) {
      fxBtn.addEventListener('click', () => {
        const wet = this.deck.toggleRouteToFx();
        this.toast(
          wet
            ? 'Track FX ON — Backing Track + Mic routed through DD-6'
            : 'Track FX DRY — Backing Track stays clean while Mic gets DD-6'
        );
      });
    }

    if (seekBar) {
      seekBar.addEventListener('input', () => {
        if (!this.deck?.audioBuffer) return;
        const targetSec = (Number(seekBar.value) / 1000) * this.deck.audioBuffer.duration;
        this.deck.seek(targetSec);
      });
    }

    if (volSlider) {
      volSlider.addEventListener('input', () => {
        this.deck.setVolume(Number(volSlider.value) / 100);
      });
    }
  }

  _renderDeckState(state) {
    const nameEl = document.getElementById('deck-track-name');
    const timeEl = document.getElementById('deck-track-time');
    const seekBar = document.getElementById('deck-seek-bar');
    const volVal = document.getElementById('deck-vol-val');
    const playBtn = document.getElementById('deck-play-btn');
    const pauseBtn = document.getElementById('deck-pause-btn');
    const stopBtn = document.getElementById('deck-stop-btn');
    const loopBtn = document.getElementById('deck-loop-btn');
    const fxBtn = document.getElementById('deck-fx-btn');

    if (nameEl) {
      nameEl.textContent = state.loaded ? state.trackName : this.i18n.t('deck_no_track');
    }
    if (timeEl) {
      timeEl.textContent = `${formatTimeMMSS(state.currentTime)} / ${formatTimeMMSS(state.duration)}`;
    }
    if (seekBar) {
      seekBar.disabled = !state.loaded;
      seekBar.value = state.duration > 0 ? String(Math.round((state.currentTime / state.duration) * 1000)) : '0';
    }
    if (volVal) volVal.textContent = `${Math.round(state.volume * 100)}%`;

    if (playBtn) {
      playBtn.disabled = !state.loaded;
      playBtn.classList.toggle('active-state', state.isPlaying);
    }
    if (pauseBtn) pauseBtn.disabled = !state.loaded || !state.isPlaying;
    if (stopBtn) stopBtn.disabled = !state.loaded;
    if (loopBtn) loopBtn.classList.toggle('active-state', state.isLooping);
    if (fxBtn) {
      fxBtn.classList.toggle('active-state', state.routeToFx);
      fxBtn.textContent = state.routeToFx ? this.i18n.t('deck_fx_wet') : this.i18n.t('deck_fx_dry');
    }
  }

  /* ========================================================================
     Saved Recordings IndexedDB Library (Play, Rename, WAV/MP3 Export, Share, Delete)
     ======================================================================== */
  async _refreshRecordingsList() {
    const listEl = document.getElementById('recordings-list');
    const countEl = document.getElementById('library-count');
    if (!listEl) return;

    let items = [];
    try {
      items = await this.media.listRecordings();
    } catch (err) {
      console.warn('[Library] IndexedDB unavailable:', err);
    }

    if (countEl) countEl.textContent = `${items.length} ${items.length === 1 ? 'take' : 'takes'}`;

    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state">${this.i18n.t('lib_empty')}</div>`;
      return;
    }

    const playingId = this.media.getPlayingId();
    listEl.innerHTML = '';

    items.forEach((rec) => {
      const card = document.createElement('div');
      card.className = 'recording-item';

      const sizeMb = (rec.sizeBytes / (1024 * 1024)).toFixed(2);
      const durStr = formatTimeMMSS(rec.duration);
      const isPlaying = playingId === rec.id;

      if (this._renamingId === rec.id) {
        const renameRow = document.createElement('div');
        renameRow.className = 'btn-row';
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'studio-input';
        inp.value = rec.name;
        inp.style.flex = '1';
        const saveBtn = document.createElement('button');
        saveBtn.type = 'button';
        saveBtn.className = 'action-btn primary';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', async () => {
          await this.media.renameRecording(rec.id, inp.value);
          this._renamingId = null;
          await this._refreshRecordingsList();
        });
        renameRow.append(inp, saveBtn);
        card.appendChild(renameRow);
        setTimeout(() => inp.focus(), 10);
      } else {
        const top = document.createElement('div');
        top.className = 'recording-top';
        const title = document.createElement('span');
        title.className = 'recording-title';
        title.textContent = rec.name;
        const info = document.createElement('span');
        info.className = 'recording-info';
        info.textContent = `${durStr} · ${sizeMb} MB · ${rec.mode}`;
        top.append(title, info);
        card.appendChild(top);
      }

      const actions = document.createElement('div');
      actions.className = 'recording-actions';

      const mkBtn = (label, cls, handler) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = `rec-mini-btn ${cls || ''}`;
        b.textContent = label;
        b.addEventListener('click', handler);
        return b;
      };

      actions.append(
        mkBtn(isPlaying ? this.i18n.t('lib_stop') : this.i18n.t('lib_play'), isPlaying ? 'play-active' : '', async () => {
          await this.media.togglePlayPreview(rec.id, () => this._refreshRecordingsList());
          await this._refreshRecordingsList();
        }),
        mkBtn(this.i18n.t('lib_rename'), '', () => {
          this._renamingId = this._renamingId === rec.id ? null : rec.id;
          this._refreshRecordingsList();
        }),
        mkBtn(this.i18n.t('lib_wav'), '', async () => {
          const { blob, filename } = await this.media.exportAsWav(rec.id);
          await this.native.saveAudioFile(blob, filename);
          this.toast(`Exported ${filename}`);
        }),
        mkBtn(this.i18n.t('lib_mp3'), '', async () => {
          this.toast('Encoding stereo MP3 (192kbps)...');
          const { blob, filename } = await this.media.exportAsMp3(rec.id);
          await this.native.saveAudioFile(blob, filename);
          this.toast(`Exported ${filename}`);
        }),
        mkBtn(this.i18n.t('lib_share'), '', async () => {
          const { blob, filename } = await this.media.exportAsWav(rec.id);
          await this.native.shareAudioFile(blob, filename, rec.name);
        }),
        mkBtn(this.i18n.t('lib_delete'), 'del-btn', async () => {
          await this.media.deleteRecording(rec.id);
          await this._refreshRecordingsList();
          this.toast('Recording deleted.');
        })
      );

      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  /* ========================================================================
     Top Utility Bar, Themes, Languages, PIN, Guide & Pro Modals
     ======================================================================== */
  _bindTopBarAndModals() {
    const scrollToPanel = (id) => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    document.getElementById('nav-deck-btn')?.addEventListener('click', () => scrollToPanel('panel-backing-deck'));
    document.getElementById('nav-library-btn')?.addEventListener('click', () => scrollToPanel('panel-library'));
    document.getElementById('nav-themes-btn')?.addEventListener('click', () => this._openModal('themes-modal'));
    document.getElementById('nav-lang-btn')?.addEventListener('click', () => {
      const next = this.i18n.cycleLanguage();
      this.toast(`Language: ${next.toUpperCase()}`);
    });
    document.getElementById('nav-pin-btn')?.addEventListener('click', () => this.pinUI.openSettings());
    document.getElementById('nav-guide-btn')?.addEventListener('click', () => this._openModal('guide-modal'));
    document.getElementById('nav-pro-btn')?.addEventListener('click', () => this.paywall.open());

    // Close Modal Buttons & Backdrop Click
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-close-modal');
        this._closeModal(id);
      });
    });

    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });

    // Hidden 14-Tap Secret Admin Bypass (14 consecutive taps on logo within 6 seconds)
    const logoTrigger = document.getElementById('brand-logo-trigger');
    const adminModal = document.getElementById('master-admin-modal');
    const adminPinInput = document.getElementById('master-admin-pin-input');
    const adminUnlockBtn = document.getElementById('master-admin-unlock-btn');
    const adminErrorEl = document.getElementById('master-admin-error');

    let tapTimestamps = [];
    if (logoTrigger && adminModal) {
      logoTrigger.addEventListener('click', () => {
        const now = Date.now();
        tapTimestamps.push(now);
        tapTimestamps = tapTimestamps.filter((t) => now - t <= 6000);
        if (tapTimestamps.length >= 14) {
          tapTimestamps = [];
          if (adminPinInput) adminPinInput.value = '';
          if (adminErrorEl) adminErrorEl.textContent = '';
          adminModal.classList.remove('hidden');
          this.native.hapticTap('medium');
          setTimeout(() => adminPinInput?.focus(), 40);
        }
      });
    }

    const submitMasterPin = () => {
      const pin = (adminPinInput?.value || '').trim();
      const res = this.license.unlockViaMasterPin(pin);
      if (res.ok) {
        adminModal?.classList.add('hidden');
        this._refreshProButton();
        this.paywall.refreshUI();
        this.native.hapticTap('heavy');
        this.toast('Master Pro Unlocked!');
      } else {
        if (adminErrorEl) adminErrorEl.textContent = res.message;
        if (adminPinInput) adminPinInput.value = '';
        this.native.hapticTap('light');
      }
    };

    if (adminUnlockBtn) {
      adminUnlockBtn.addEventListener('click', submitMasterPin);
    }
    if (adminPinInput) {
      adminPinInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitMasterPin();
      });
    }
  }

  _openModal(id) {
    document.getElementById(id)?.classList.remove('hidden');
  }

  _closeModal(id) {
    document.getElementById(id)?.classList.add('hidden');
  }

  _renderThemeCards() {
    const grid = document.getElementById('theme-picker-grid');
    if (!grid) return;
    const active = this.themeManager.getActive();
    grid.innerHTML = '';

    VOXSYNTH_THEMES.forEach((theme) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `theme-card ${theme.id === active.id ? 'active' : ''}`;

      const bar = document.createElement('div');
      bar.className = 'theme-swatch-bar';
      theme.swatches.forEach((hex) => {
        const s = document.createElement('span');
        s.style.background = hex;
        bar.appendChild(s);
      });

      const title = document.createElement('div');
      title.className = 'theme-name';
      title.textContent = this.i18n.t(theme.nameKey) || theme.fallbackName;

      btn.append(bar, title);
      btn.addEventListener('click', () => {
        this.themeManager.apply(theme.id);
        this.native.hapticTap('light');
      });
      grid.appendChild(btn);
    });
  }

  _onLanguageChanged() {
    this._updateLangButton();
    this._renderThemeCards();
    this._refreshProButton();
    this._syncPedalUI();
    if (this.deck) this._renderDeckState(this.deck.getState());
    this._refreshRecordingsList();
  }

  _updateLangButton() {
    const el = document.getElementById('nav-lang-label');
    if (el) el.textContent = this.i18n.t('langName');
  }

  _refreshProButton() {
    const btn = document.getElementById('nav-pro-btn');
    const lbl = document.getElementById('nav-pro-label');
    const unlocked = this.license.isPro();
    if (btn) btn.classList.toggle('unlocked', unlocked);
    if (lbl) lbl.textContent = unlocked ? this.i18n.t('nav_pro_unlocked') : this.i18n.t('nav_pro');
  }

  toast(message) {
    const shelf = document.getElementById('toast-shelf');
    if (!shelf) return;
    const item = document.createElement('div');
    item.className = 'toast-item';
    item.textContent = message;
    shelf.appendChild(item);
    setTimeout(() => {
      item.style.opacity = '0';
      item.style.transition = 'opacity 180ms ease';
      setTimeout(() => item.remove(), 200);
    }, 2600);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new VoxSynthApp();
  app.init();
});
