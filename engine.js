/**
 * VoxSynth DD-6 — Studio Digital Delay & Phrase Looper DSP Engine (engine.js)
 * Features:
 * - Dual DelayNodes with maxDelayTime = 5.5s (50ms..3200ms active sweep)
 * - 6 Click-Stop DD-6 Modes: SHORT, MEDIUM, LONG, CUSTOM, WARP/REV, HOLD (5.2s looper)
 * - Soft-clipper warm saturation limiter inside feedback loop (0%..98% safe oscillation)
 * - Clickless Mono / Stereo Ping-Pong switching
 * - Real-time pitch-modulated Warp LFO & Reverse Echo buffer in WARP/REV mode
 * - Clickless Bypass/Effect stomp with master brickwall limiter & analysers
 */

export const DD6_MODES = [
  { id: 'S', name: 'SHORT', minMs: 50, maxMs: 200 },
  { id: 'M', name: 'MEDIUM', minMs: 200, maxMs: 800 },
  { id: 'L', name: 'LONG', minMs: 800, maxMs: 3200 },
  { id: 'CUSTOM', name: 'CUSTOM', minMs: 50, maxMs: 3200 },
  { id: 'WARP', name: 'WARP/REV', minMs: 80, maxMs: 1600 },
  { id: 'HOLD', name: 'HOLD LOOP', minMs: 50, maxMs: 3200 },
];

export class DD6Engine {
  constructor(audioContext) {
    this.ctx = audioContext;

    // Core Parameters
    this.active = true; // Pedal Active vs Bypass
    this.modeIndex = 1; // Default: MEDIUM (200-800ms)
    this.delayMs = 420; // 50..3200ms
    this.effectLevel = 58; // 0..100%
    this.feedback = 46; // 0..98%
    this.pingPong = false;

    // HOLD 5.2s Phrase Looper State
    this.holdState = 'idle'; // 'idle' | 'recording' | 'playing'
    this.holdMaxSeconds = 5.2;
    this._holdChunksL = [];
    this._holdChunksR = [];
    this._holdRecordedSamples = 0;
    this._holdSource = null;

    // Tap Tempo History
    this._tapTimes = [];

    // Audio Graph Nodes
    this.fxInput = this.ctx.createGain();
    this.dryBus = this.ctx.createGain();
    this.wetSendGate = this.ctx.createGain();
    this.wetMasterGain = this.ctx.createGain();

    // External Backing Track Dry Injection Bus (bypasses DD-6 when TRACK FX is OFF)
    this.backingDryBus = this.ctx.createGain();
    // Bluetooth Latency Sync Delay Node for Backing Track alignment
    this.btSyncDelay = this.ctx.createDelay(0.5);
    this.btSyncDelay.delayTime.value = 0;

    // Main Stereo Delay Lines (maxDelayTime initialized to 5.5s as specified)
    this.delayL = this.ctx.createDelay(5.5);
    this.delayR = this.ctx.createDelay(5.5);

    // Feedback Tone & Soft-Clipper Limiter (keeps 98% feedback warm and clip-free)
    this.fbFilter = this.ctx.createBiquadFilter();
    this.fbFilter.type = 'lowpass';
    this.fbFilter.frequency.value = 9200;

    this.fbClipperL = this.ctx.createWaveShaper();
    this.fbClipperR = this.ctx.createWaveShaper();
    const softCurve = this._makeSoftClipCurve(2.2);
    this.fbClipperL.curve = softCurve;
    this.fbClipperR.curve = softCurve;
    this.fbClipperL.oversample = '2x';
    this.fbClipperR.oversample = '2x';

    // Feedback Routing Gains (Mono vs Ping-Pong cross-feedback)
    this.fbMonoL = this.ctx.createGain();
    this.fbMonoR = this.ctx.createGain();
    this.fbCrossLtoR = this.ctx.createGain();
    this.fbCrossRtoL = this.ctx.createGain();

    // Stereo Panning for Wide Ping-Pong vs Centered Mono
    this.panL = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();
    this.panR = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : this.ctx.createGain();

    // WARP / REV Synth Pitch-Modulation LFO
    this.warpLfo = this.ctx.createOscillator();
    this.warpLfo.type = 'sine';
    this.warpLfo.frequency.value = 1.65;
    this.warpDepthL = this.ctx.createGain();
    this.warpDepthR = this.ctx.createGain();
    this.warpDepthL.gain.value = 0;
    this.warpDepthR.gain.value = 0;
    this.warpLfo.connect(this.warpDepthL);
    this.warpLfo.connect(this.warpDepthR);
    this.warpDepthL.connect(this.delayL.delayTime);
    this.warpDepthR.connect(this.delayR.delayTime);
    this.warpLfo.start();

    // Real-Time Reverse Echo Processor + HOLD Phrase Recorder Node
    this.reverseMix = this.ctx.createGain();
    this.reverseMix.gain.value = 0;
    this._setupReverseAndHoldProcessor();

    // Hold Playback Bus
    this.holdBus = this.ctx.createGain();
    this.holdBus.gain.value = 0.92;

    // Master Limiter & Output Analysers
    this.masterSumming = this.ctx.createGain();
    this.masterLimiter = this.ctx.createDynamicsCompressor();
    this.masterLimiter.threshold.value = -1.5;
    this.masterLimiter.knee.value = 6;
    this.masterLimiter.ratio.value = 14;
    this.masterLimiter.attack.value = 0.002;
    this.masterLimiter.release.value = 0.08;

    this.outputAnalyser = this.ctx.createAnalyser();
    this.outputAnalyser.fftSize = 2048;
    this.outputAnalyser.smoothingTimeConstant = 0.78;

    this.masterOutput = this.ctx.createGain();
    this.masterOutput.gain.value = 1.0;

    // Wire DSP Graph
    // 1. Direct dry voice path
    this.fxInput.connect(this.dryBus);
    this.dryBus.connect(this.masterSumming);

    // 2. Wet DD-6 Delay path
    this.fxInput.connect(this.wetSendGate);
    this.wetSendGate.connect(this.delayL);

    // Mono input feed to R delay (muted in ping-pong so R only receives crossed L)
    this.inputToDelayR = this.ctx.createGain();
    this.wetSendGate.connect(this.inputToDelayR);
    this.inputToDelayR.connect(this.delayR);

    // Delay -> Clipper -> Output Panners
    this.delayL.connect(this.fbClipperL);
    this.delayR.connect(this.fbClipperR);

    this.fbClipperL.connect(this.panL);
    this.fbClipperR.connect(this.panR);

    this.panL.connect(this.wetMasterGain);
    this.panR.connect(this.wetMasterGain);

    // Feedback Loops (filtered for warm digital-analog hybrid tails)
    this.fbClipperL.connect(this.fbMonoL);
    this.fbMonoL.connect(this.fbFilter);
    this.fbFilter.connect(this.delayL);

    this.fbClipperR.connect(this.fbMonoR);
    this.fbMonoR.connect(this.delayR);

    // Cross-coupled Stereo Ping-Pong Loop
    this.fbClipperL.connect(this.fbCrossLtoR);
    this.fbCrossLtoR.connect(this.delayR);
    this.fbClipperR.connect(this.fbCrossRtoL);
    this.fbCrossRtoL.connect(this.delayL);

    // Reverse Echo Parallel Output
    this.wetSendGate.connect(this.revHoldNode);
    this.revHoldNode.connect(this.reverseMix);
    this.reverseMix.connect(this.wetMasterGain);

    // Hold Looper Output -> Master
    this.holdBus.connect(this.masterSumming);

    // Wet Delay Master -> Master Summing
    this.wetMasterGain.connect(this.masterSumming);

    // Backing Track Dry Bus -> BT Sync Delay -> Master Summing
    this.backingDryBus.connect(this.btSyncDelay);
    this.btSyncDelay.connect(this.masterSumming);

    // Master Limiter -> Output Analyser -> Audio Destination
    this.masterSumming.connect(this.masterLimiter);
    this.masterLimiter.connect(this.outputAnalyser);
    this.outputAnalyser.connect(this.masterOutput);
    this.masterOutput.connect(this.ctx.destination);

    this._onHoldChange = null;
    this.applyAllParameters();
  }

  _makeSoftClipCurve(drive = 2.0) {
    const samples = 2048;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    return curve;
  }

  _setupReverseAndHoldProcessor() {
    const bufferSize = 2048;
    this.revHoldNode = this.ctx.createScriptProcessor(bufferSize, 2, 2);

    // Ring buffer for real-time windowed reverse echo
    const maxRevSamples = Math.floor(this.ctx.sampleRate * 2.0);
    const revRingL = new Float32Array(maxRevSamples);
    const revRingR = new Float32Array(maxRevSamples);
    let writePos = 0;
    let grainCounter = 0;

    this.revHoldNode.onaudioprocess = (event) => {
      const inL = event.inputBuffer.getChannelData(0);
      const inR = event.inputBuffer.numberOfChannels > 1
        ? event.inputBuffer.getChannelData(1)
        : inL;
      const outL = event.outputBuffer.getChannelData(0);
      const outR = event.outputBuffer.getChannelData(1);

      // 1. HOLD Looper Capture when recording
      if (this.holdState === 'recording') {
        const copyL = new Float32Array(inL.length);
        const copyR = new Float32Array(inR.length);
        copyL.set(inL);
        copyR.set(inR);
        this._holdChunksL.push(copyL);
        this._holdChunksR.push(copyR);
        this._holdRecordedSamples += inL.length;

        const maxSamples = Math.floor(this.ctx.sampleRate * this.holdMaxSeconds);
        if (this._holdRecordedSamples >= maxSamples) {
          this.stopHoldRecordingAndPlay();
        }
      }

      // 2. Real-time Reverse Grain Echo (active in WARP / REV mode)
      const isWarpMode = DD6_MODES[this.modeIndex].id === 'WARP' && this.active;
      const grainLen = Math.max(
        4096,
        Math.min(maxRevSamples - 2048, Math.floor((this.delayMs / 1000) * this.ctx.sampleRate))
      );

      for (let i = 0; i < inL.length; i++) {
        revRingL[writePos] = inL[i];
        revRingR[writePos] = inR[i];

        if (isWarpMode) {
          const posInGrain = grainCounter % grainLen;
          // Hann window prevents clicks at reverse grain boundaries
          const win = 0.5 * (1 - Math.cos((2 * Math.PI * posInGrain) / grainLen));
          let readIdx = writePos - posInGrain * 2;
          while (readIdx < 0) readIdx += maxRevSamples;
          readIdx %= maxRevSamples;

          outL[i] = revRingL[readIdx] * win * 0.85;
          outR[i] = revRingR[readIdx] * win * 0.85;
          grainCounter++;
        } else {
          outL[i] = 0;
          outR[i] = 0;
        }

        writePos = (writePos + 1) % maxRevSamples;
      }
    };
  }

  onHoldStateChange(cb) {
    this._onHoldChange = cb;
  }

  getModeObj() {
    return DD6_MODES[this.modeIndex] || DD6_MODES[1];
  }

  applyAllParameters() {
    this.setActive(this.active);
    this.setDelayMs(this.delayMs);
    this.setEffectLevel(this.effectLevel);
    this.setFeedback(this.feedback);
    this.setPingPong(this.pingPong);
    this._applyModeDSP();
  }

  setActive(isActive) {
    this.active = Boolean(isActive);
    const now = this.ctx.currentTime;
    // Clickless 15ms crossfade on wet send (preserves smooth natural tail decay)
    this.wetSendGate.gain.setTargetAtTime(this.active ? 1.0 : 0.0, now, 0.015);
    this._applyModeDSP();
  }

  toggleBypass() {
    const mode = this.getModeObj();
    if (mode.id === 'HOLD') {
      this.cycleHoldLooper();
      return this.active;
    }
    this.setActive(!this.active);
    return this.active;
  }

  setModeIndex(index) {
    const clamped = Math.max(0, Math.min(DD6_MODES.length - 1, Math.round(index)));
    const prevMode = this.getModeObj();
    this.modeIndex = clamped;
    const mode = this.getModeObj();

    if (prevMode.id === 'HOLD' && mode.id !== 'HOLD') {
      this.clearHoldLoop();
    }

    // Snap delayMs cleanly inside mode bounds for S / M / L / WARP
    if (this.delayMs < mode.minMs || this.delayMs > mode.maxMs) {
      const clampedMs = Math.max(mode.minMs, Math.min(mode.maxMs, this.delayMs));
      this.setDelayMs(clampedMs);
    }

    this._applyModeDSP();
    return mode;
  }

  _applyModeDSP() {
    const mode = this.getModeObj();
    const now = this.ctx.currentTime;

    if (mode.id === 'WARP' && this.active) {
      this.warpDepthL.gain.setTargetAtTime(0.0045, now, 0.04);
      this.warpDepthR.gain.setTargetAtTime(-0.0045, now, 0.04);
      this.reverseMix.gain.setTargetAtTime(0.68, now, 0.04);
    } else {
      this.warpDepthL.gain.setTargetAtTime(0, now, 0.03);
      this.warpDepthR.gain.setTargetAtTime(0, now, 0.03);
      this.reverseMix.gain.setTargetAtTime(0, now, 0.03);
    }
  }

  setDelayMs(ms) {
    const clamped = Math.max(50, Math.min(3200, Math.round(Number(ms) || 400)));
    this.delayMs = clamped;
    const sec = clamped / 1000;
    const now = this.ctx.currentTime;

    this.delayL.delayTime.setTargetAtTime(sec, now, 0.025);
    // In ping-pong mode R repeats at the same rhythmic interval after L
    this.delayR.delayTime.setTargetAtTime(sec, now, 0.025);
    return this.delayMs;
  }

  nudgeDelayMs(delta) {
    return this.setDelayMs(this.delayMs + delta);
  }

  getBpm() {
    return Math.round((60000 / Math.max(50, this.delayMs)) * 10) / 10;
  }

  tapTempo() {
    const now = performance.now();
    if (this._tapTimes.length > 0 && now - this._tapTimes[this._tapTimes.length - 1] > 3500) {
      this._tapTimes = [];
    }
    this._tapTimes.push(now);
    if (this._tapTimes.length > 5) {
      this._tapTimes.shift();
    }
    if (this._tapTimes.length >= 2) {
      let total = 0;
      for (let i = 1; i < this._tapTimes.length; i++) {
        total += this._tapTimes[i] - this._tapTimes[i - 1];
      }
      const avgMs = total / (this._tapTimes.length - 1);
      this.setDelayMs(avgMs);
    }
    return this.delayMs;
  }

  setEffectLevel(percent) {
    const val = Math.max(0, Math.min(100, Number(percent) || 0));
    this.effectLevel = val;
    const wetGain = (val / 100) * 1.15;
    this.wetMasterGain.gain.setTargetAtTime(wetGain, this.ctx.currentTime, 0.015);
  }

  setFeedback(percent) {
    const val = Math.max(0, Math.min(98, Number(percent) || 0));
    this.feedback = val;
    this._updateFeedbackRouting();
  }

  setPingPong(enabled) {
    this.pingPong = Boolean(enabled);
    const now = this.ctx.currentTime;

    if (this.panL.pan && this.panR.pan) {
      this.panL.pan.setTargetAtTime(this.pingPong ? -0.82 : 0, now, 0.025);
      this.panR.pan.setTargetAtTime(this.pingPong ? 0.82 : 0, now, 0.025);
    }

    // In ping-pong mode, initial input goes into L, then bounces to R
    this.inputToDelayR.gain.setTargetAtTime(this.pingPong ? 0.0 : 1.0, now, 0.02);
    this._updateFeedbackRouting();
  }

  _updateFeedbackRouting() {
    const fb = (this.feedback / 100) * 0.96; // Protected safely below runaway
    const now = this.ctx.currentTime;

    if (this.pingPong) {
      this.fbMonoL.gain.setTargetAtTime(0, now, 0.02);
      this.fbMonoR.gain.setTargetAtTime(0, now, 0.02);
      this.fbCrossLtoR.gain.setTargetAtTime(Math.max(0.75, fb), now, 0.02);
      this.fbCrossRtoL.gain.setTargetAtTime(fb, now, 0.02);
    } else {
      this.fbCrossLtoR.gain.setTargetAtTime(0, now, 0.02);
      this.fbCrossRtoL.gain.setTargetAtTime(0, now, 0.02);
      this.fbMonoL.gain.setTargetAtTime(fb, now, 0.02);
      this.fbMonoR.gain.setTargetAtTime(fb, now, 0.02);
    }
  }

  setBtSyncOffsetMs(ms) {
    const sec = Math.max(0, Math.min(0.25, (Number(ms) || 0) / 1000));
    this.btSyncDelay.delayTime.setTargetAtTime(sec, this.ctx.currentTime, 0.02);
  }

  // HOLD 5.2s Phrase Looper Controls
  cycleHoldLooper() {
    if (this.holdState === 'idle') {
      this.startHoldRecording();
    } else if (this.holdState === 'recording') {
      this.stopHoldRecordingAndPlay();
    } else {
      this.clearHoldLoop();
    }
  }

  startHoldRecording() {
    this.clearHoldLoop();
    this.active = true;
    this.wetSendGate.gain.setTargetAtTime(1.0, this.ctx.currentTime, 0.01);
    this._holdChunksL = [];
    this._holdChunksR = [];
    this._holdRecordedSamples = 0;
    this.holdState = 'recording';
    if (this._onHoldChange) this._onHoldChange(this.holdState);
  }

  stopHoldRecordingAndPlay() {
    if (this.holdState !== 'recording') return;
    if (this._holdRecordedSamples < 1024) {
      this.clearHoldLoop();
      return;
    }

    const total = this._holdRecordedSamples;
    const buffer = this.ctx.createBuffer(2, total, this.ctx.sampleRate);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    let offset = 0;
    for (let i = 0; i < this._holdChunksL.length; i++) {
      chL.set(this._holdChunksL[i], offset);
      chR.set(this._holdChunksR[i], offset);
      offset += this._holdChunksL[i].length;
    }

    // Apply 8ms crossfade at loop seam for click-free phrase looping
    const fade = Math.min(Math.floor(this.ctx.sampleRate * 0.008), Math.floor(total / 4));
    for (let i = 0; i < fade; i++) {
      const ramp = i / fade;
      chL[i] *= ramp;
      chR[i] *= ramp;
      chL[total - 1 - i] *= ramp;
      chR[total - 1 - i] *= ramp;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.holdBus);
    src.start();
    this._holdSource = src;
    this.holdState = 'playing';

    if (this._onHoldChange) this._onHoldChange(this.holdState);
  }

  clearHoldLoop() {
    if (this._holdSource) {
      try {
        this._holdSource.stop();
        this._holdSource.disconnect();
      } catch (_) {}
      this._holdSource = null;
    }
    this._holdChunksL = [];
    this._holdChunksR = [];
    this._holdRecordedSamples = 0;
    this.holdState = 'idle';
    if (this._onHoldChange) this._onHoldChange(this.holdState);
  }

  destroy() {
    this.clearHoldLoop();
    try {
      this.warpLfo.stop();
      this.revHoldNode.disconnect();
    } catch (_) {}
  }
}
