/**
 * VoxSynth DD-6 — Studio Digital OLED / LCD Display Controller (display.js)
 * Renders 60fps real-time Oscilloscope Waveform & Frequency Spectrum Analyzer
 * alongside Dual Input (Mic) & Output (Master) dB Peak Level Meters + Telemetry.
 */

export class StudioDisplay {
  constructor(options = {}) {
    this.canvas = document.getElementById('oled-canvas');
    this.ctx2d = this.canvas ? this.canvas.getContext('2d') : null;

    this.vizMode = 'scope'; // 'scope' | 'spectrum'
    this.inputAnalyser = null;
    this.outputAnalyser = null;

    this._rafId = null;
    this._timeData = new Float32Array(2048);
    this._freqData = new Uint8Array(1024);
    this._inData = new Float32Array(1024);

    this._inPeakHold = 0;
    this._outPeakHold = 0;
    this._inClipUntil = 0;
    this._outClipUntil = 0;

    // DOM Element Cache
    this.elMsInput = document.getElementById('oled-ms-input');
    this.elBpm = document.getElementById('oled-bpm-value');
    this.elMode = document.getElementById('oled-mode-status');
    this.elPedalState = document.getElementById('oled-pedal-state');
    this.elRoute = document.getElementById('oled-route-badge');
    this.elMic = document.getElementById('oled-mic-status');
    this.elRec = document.getElementById('oled-rec-status');
    this.elRecText = document.getElementById('oled-rec-text');

    this.elVuInFill = document.getElementById('vu-in-fill');
    this.elVuInDb = document.getElementById('vu-in-db');
    this.elVuInClip = document.getElementById('vu-in-clip');

    this.elVuOutFill = document.getElementById('vu-out-fill');
    this.elVuOutDb = document.getElementById('vu-out-db');
    this.elVuOutClip = document.getElementById('vu-out-clip');

    this._palette = {
      primary: '#38bdf8',
      secondary: '#7dd3fc',
      grid: 'rgba(56, 189, 248, 0.14)',
      bg: '#050c14',
    };

    if (options.inputAnalyser && options.outputAnalyser) {
      this.attachAnalysers(options.inputAnalyser, options.outputAnalyser);
    }

    this._syncPaletteFromCSS();
    this._handleResize();
    window.addEventListener('resize', () => this._handleResize());
  }

  attachAnalysers(inputAnalyser, outputAnalyser) {
    this.inputAnalyser = inputAnalyser;
    this.outputAnalyser = outputAnalyser;
    if (inputAnalyser) {
      this._inData = new Float32Array(inputAnalyser.fftSize);
    }
    if (outputAnalyser) {
      this._timeData = new Float32Array(outputAnalyser.fftSize);
      this._freqData = new Uint8Array(outputAnalyser.frequencyBinCount);
    }
  }

  setVizMode(mode) {
    this.vizMode = mode === 'spectrum' ? 'spectrum' : 'scope';
  }

  refreshThemePalette() {
    this._syncPaletteFromCSS();
  }

  _syncPaletteFromCSS() {
    const cs = getComputedStyle(document.documentElement);
    this._palette = {
      primary: cs.getPropertyValue('--oled-primary').trim() || '#38bdf8',
      secondary: cs.getPropertyValue('--oled-secondary').trim() || '#7dd3fc',
      grid: cs.getPropertyValue('--oled-grid').trim() || 'rgba(56, 189, 248, 0.14)',
      bg: cs.getPropertyValue('--oled-bg').trim() || '#050c14',
    };
  }

  _handleResize() {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(240, Math.floor(rect.width * dpr));
    const h = Math.max(88, Math.floor(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  updateReadout({ delayMs, bpm, modeName, active, holdState }) {
    if (this.elMsInput && document.activeElement !== this.elMsInput) {
      this.elMsInput.value = String(Math.round(delayMs));
    }
    if (this.elBpm) {
      this.elBpm.textContent = bpm.toFixed(1);
    }
    if (this.elMode && modeName) {
      if (modeName === 'HOLD LOOP' && holdState && holdState !== 'idle') {
        this.elMode.textContent = holdState === 'recording' ? 'HOLD REC' : 'HOLD PLAY';
      } else {
        this.elMode.textContent = modeName;
      }
    }
    if (this.elPedalState) {
      this.elPedalState.textContent = active ? 'ACTIVE' : 'BYPASS';
      this.elPedalState.classList.toggle('active', Boolean(active));
      this.elPedalState.classList.toggle('bypass', !active);
    }
  }

  updateHardwareBadge(label) {
    if (this.elRoute) {
      this.elRoute.textContent = label || '3.5MM WIRED';
    }
  }

  updateMicStatus(isLive) {
    if (this.elMic) {
      this.elMic.textContent = isLive ? 'MIC LIVE' : 'MUTED';
      this.elMic.classList.toggle('live', Boolean(isLive));
      this.elMic.classList.toggle('muted', !isLive);
    }
  }

  updateRecordingStatus(isRecording, isPaused, formattedTime) {
    if (!this.elRec || !this.elRecText) return;
    if (isRecording) {
      this.elRec.classList.add('recording');
      this.elRecText.textContent = isPaused ? `PAUSE ${formattedTime}` : `REC ${formattedTime}`;
    } else {
      this.elRec.classList.remove('recording');
      this.elRecText.textContent = 'REC 00:00';
    }
  }

  start() {
    if (this._rafId) return;
    const renderFrame = (timestamp) => {
      this._drawVisualizer();
      this._updateMeters(timestamp);
      this._rafId = requestAnimationFrame(renderFrame);
    };
    this._rafId = requestAnimationFrame(renderFrame);
  }

  stop() {
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
  }

  _computePeakAndDb(buffer) {
    let peak = 0;
    for (let i = 0; i < buffer.length; i++) {
      const abs = Math.abs(buffer[i]);
      if (abs > peak) peak = abs;
    }
    const db = peak > 0.0001 ? 20 * Math.log10(peak) : -60;
    const clampedDb = Math.max(-60, Math.min(0, db));
    const percent = ((clampedDb + 60) / 60) * 100;
    return { peak, db: clampedDb, percent };
  }

  _updateMeters(nowMs) {
    let inMeter = { peak: 0, db: -60, percent: 0 };
    let outMeter = { peak: 0, db: -60, percent: 0 };

    if (this.inputAnalyser) {
      this.inputAnalyser.getFloatTimeDomainData(this._inData);
      inMeter = this._computePeakAndDb(this._inData);
    }

    if (this.outputAnalyser) {
      this.outputAnalyser.getFloatTimeDomainData(this._timeData);
      outMeter = this._computePeakAndDb(this._timeData);
    }

    this._inPeakHold = Math.max(inMeter.percent, this._inPeakHold * 0.91);
    this._outPeakHold = Math.max(outMeter.percent, this._outPeakHold * 0.91);

    if (inMeter.peak >= 0.94) this._inClipUntil = nowMs + 900;
    if (outMeter.peak >= 0.94) this._outClipUntil = nowMs + 900;

    if (this.elVuInFill) this.elVuInFill.style.width = `${this._inPeakHold.toFixed(1)}%`;
    if (this.elVuInDb) this.elVuInDb.textContent = inMeter.db <= -59 ? '-∞dB' : `${inMeter.db.toFixed(1)}dB`;
    if (this.elVuInClip) this.elVuInClip.classList.toggle('lit', nowMs < this._inClipUntil);

    if (this.elVuOutFill) this.elVuOutFill.style.width = `${this._outPeakHold.toFixed(1)}%`;
    if (this.elVuOutDb) this.elVuOutDb.textContent = outMeter.db <= -59 ? '-∞dB' : `${outMeter.db.toFixed(1)}dB`;
    if (this.elVuOutClip) this.elVuOutClip.classList.toggle('lit', nowMs < this._outClipUntil);
  }

  _drawVisualizer() {
    if (!this.ctx2d || !this.canvas) return;
    const ctx = this.ctx2d;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.clearRect(0, 0, w, h);

    // Subtle Center Reference Line
    ctx.strokeStyle = this._palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    if (!this.outputAnalyser) {
      // Idle flat trace
      ctx.strokeStyle = this._palette.primary;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      return;
    }

    if (this.vizMode === 'scope') {
      this.outputAnalyser.getFloatTimeDomainData(this._timeData);

      // Zero-crossing trigger stabilization for clean oscilloscope readability
      let triggerIndex = 0;
      for (let i = 1; i < this._timeData.length / 2; i++) {
        if (this._timeData[i - 1] < 0 && this._timeData[i] >= 0) {
          triggerIndex = i;
          break;
        }
      }

      const drawCount = Math.min(768, this._timeData.length - triggerIndex);
      ctx.save();
      ctx.strokeStyle = this._palette.primary;
      ctx.lineWidth = 2.2;
      ctx.shadowColor = this._palette.primary;
      ctx.shadowBlur = 8;
      ctx.beginPath();

      for (let i = 0; i < drawCount; i++) {
        const x = (i / (drawCount - 1)) * w;
        const sample = this._timeData[triggerIndex + i] || 0;
        const y = h / 2 - sample * (h * 0.44);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    } else {
      // 48-Band Studio Frequency Spectrum Analyzer
      this.outputAnalyser.getByteFrequencyData(this._freqData);
      const bars = 48;
      const gap = 3;
      const barWidth = (w - gap * (bars - 1)) / bars;

      for (let i = 0; i < bars; i++) {
        // Logarithmic frequency bin grouping (better vocal midrange resolution)
        const binIndex = Math.floor(Math.pow(i / bars, 1.55) * (this._freqData.length * 0.48));
        const value = this._freqData[binIndex] / 255;
        const barH = Math.max(3, value * (h - 10));
        const x = i * (barWidth + gap);
        const y = h - barH;

        ctx.fillStyle = value > 0.78 ? '#f59e0b' : this._palette.primary;
        ctx.fillRect(x, y, barWidth, barH);

        ctx.fillStyle = this._palette.secondary;
        ctx.fillRect(x, Math.max(0, y - 3), barWidth, 2);
      }
    }
  }
}
