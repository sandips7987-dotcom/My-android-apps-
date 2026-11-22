/**
 * VoxSynth DD-6 — Studio Voice Preamp, Noise Gate, Vocal EQ & Hall Reverb (voice-processor.js)
 * Provides +24dB clean preamp gain, real-time RMS noise gate, analog-to-air EQ sweep,
 * vocal leveling compressor, algorithmic stereo hall reverb, and audition synth trigger.
 */

export class VoiceProcessor {
  constructor(audioContext, router) {
    this.ctx = audioContext;
    this.router = router;

    this.stream = null;
    this.micSource = null;
    this.micLive = false;
    this.rawCaptureMode = true;

    // Parameters
    this.params = {
      micGainDb: 6,      // 0dB .. +24dB
      gateAmount: 22,    // 0 .. 100%
      tone: 56,          // 0 (warm LP) .. 50 (flat) .. 100 (crisp 3kHz/10kHz presence)
      reverbMix: 24,     // 0 .. 100%
    };

    // Build DSP Chain
    this.inputMix = this.ctx.createGain();
    this.preampGain = this.ctx.createGain();
    this.highPass = this.ctx.createBiquadFilter();
    this.highPass.type = 'highpass';
    this.highPass.frequency.value = 82;
    this.highPass.Q.value = 0.707;

    // Analyser used for real-time Noise Gate envelope follower + Input VU Meter
    this.inputAnalyser = this.ctx.createAnalyser();
    this.inputAnalyser.fftSize = 1024;
    this.inputAnalyser.smoothingTimeConstant = 0.75;

    // Gate VCA
    this.gateGain = this.ctx.createGain();
    this.gateGain.gain.value = 1;

    // Vocal Tone / EQ Stage: Warm Lowpass + 3kHz Presence Peak + 10kHz Air Shelf
    this.warmLp = this.ctx.createBiquadFilter();
    this.warmLp.type = 'lowpass';
    this.warmLp.frequency.value = 18000;
    this.warmLp.Q.value = 0.7;

    this.presenceEq = this.ctx.createBiquadFilter();
    this.presenceEq.type = 'peaking';
    this.presenceEq.frequency.value = 3000;
    this.presenceEq.Q.value = 1.1;
    this.presenceEq.gain.value = 0;

    this.airShelf = this.ctx.createBiquadFilter();
    this.airShelf.type = 'highshelf';
    this.airShelf.frequency.value = 10000;
    this.airShelf.gain.value = 0;

    // Gentle Vocal Studio Compressor
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3.2;
    this.compressor.attack.value = 0.006;
    this.compressor.release.value = 0.14;

    // Stereo Algorithmic Hall Reverb
    this.reverbConvolver = this.ctx.createConvolver();
    this.reverbConvolver.buffer = this._generateStereoHallIR(2.35, 2.8);
    this.reverbPreDelay = this.ctx.createDelay(0.1);
    this.reverbPreDelay.delayTime.value = 0.022;
    this.reverbDamp = this.ctx.createBiquadFilter();
    this.reverbDamp.type = 'lowpass';
    this.reverbDamp.frequency.value = 6800;
    this.reverbWet = this.ctx.createGain();
    this.reverbDry = this.ctx.createGain();

    // Final Voice Output Bus (feeds into DD-6 Delay Engine)
    this.outputNode = this.ctx.createGain();

    // Wire Main Vocal Chain
    this.inputMix.connect(this.preampGain);
    this.preampGain.connect(this.highPass);
    this.highPass.connect(this.inputAnalyser);
    this.inputAnalyser.connect(this.gateGain);
    this.gateGain.connect(this.warmLp);
    this.warmLp.connect(this.presenceEq);
    this.presenceEq.connect(this.airShelf);
    this.airShelf.connect(this.compressor);

    // Dry & Reverb Parallel Blend
    this.compressor.connect(this.reverbDry);
    this.reverbDry.connect(this.outputNode);

    this.compressor.connect(this.reverbPreDelay);
    this.reverbPreDelay.connect(this.reverbConvolver);
    this.reverbConvolver.connect(this.reverbDamp);
    this.reverbDamp.connect(this.reverbWet);
    this.reverbWet.connect(this.outputNode);

    // Gate runtime buffer
    this._gateBuffer = new Float32Array(this.inputAnalyser.fftSize);
    this._gateOpen = true;
    this._gateRaf = null;

    this._applyAllParams();
    this._startGateLoop();
  }

  _generateStereoHallIR(durationSec, decay) {
    const sampleRate = this.ctx.sampleRate;
    const length = Math.floor(sampleRate * durationSec);
    const impulse = this.ctx.createBuffer(2, length, sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      const dampCoeff = ch === 0 ? 0.24 : 0.27;
      for (let i = 0; i < length; i++) {
        const n = i / length;
        // Early reflection shimmer + smooth exponential tail
        const env = Math.pow(1 - n, decay) * (1 - Math.exp(-i / (sampleRate * 0.012)));
        const white = Math.random() * 2 - 1;
        lp = lp + dampCoeff * (white - lp);
        data[i] = lp * env * 0.65;
      }
    }
    return impulse;
  }

  _applyAllParams() {
    this.setMicGainDb(this.params.micGainDb);
    this.setGate(this.params.gateAmount);
    this.setTone(this.params.tone);
    this.setReverb(this.params.reverbMix);
  }

  setMicGainDb(db) {
    const clamped = Math.max(0, Math.min(24, Number(db) || 0));
    this.params.micGainDb = clamped;
    const linear = Math.pow(10, clamped / 20);
    this.preampGain.gain.setTargetAtTime(linear, this.ctx.currentTime, 0.015);
  }

  setGate(percent) {
    const clamped = Math.max(0, Math.min(100, Number(percent) || 0));
    this.params.gateAmount = clamped;
  }

  setTone(percent) {
    const val = Math.max(0, Math.min(100, Number(percent) || 50));
    this.params.tone = val;
    const now = this.ctx.currentTime;

    if (val < 50) {
      // Warm analog vocal low-pass sweep (16kHz down to 1.8kHz)
      const norm = val / 50; // 0..1
      const cutoff = 1800 * Math.pow(16000 / 1800, norm);
      this.warmLp.frequency.setTargetAtTime(cutoff, now, 0.02);
      this.presenceEq.gain.setTargetAtTime((norm - 1) * 2.5, now, 0.02);
      this.airShelf.gain.setTargetAtTime((norm - 1) * 4, now, 0.02);
    } else {
      // Crisp studio presence (3kHz) & vocal air (10kHz)
      const norm = (val - 50) / 50; // 0..1
      this.warmLp.frequency.setTargetAtTime(19500, now, 0.02);
      this.presenceEq.gain.setTargetAtTime(norm * 6.5, now, 0.02);
      this.airShelf.gain.setTargetAtTime(norm * 7.5, now, 0.02);
    }
  }

  setReverb(percent) {
    const val = Math.max(0, Math.min(100, Number(percent) || 0));
    this.params.reverbMix = val;
    const wet = (val / 100) * 0.72;
    const dry = 1 - wet * 0.25;
    const now = this.ctx.currentTime;
    this.reverbWet.gain.setTargetAtTime(wet, now, 0.02);
    this.reverbDry.gain.setTargetAtTime(dry, now, 0.02);
  }

  _startGateLoop() {
    const tick = () => {
      if (!this.ctx || this.ctx.state === 'closed') return;

      if (this.params.gateAmount <= 1) {
        this.gateGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.015);
      } else {
        this.inputAnalyser.getFloatTimeDomainData(this._gateBuffer);
        let sum = 0;
        for (let i = 0; i < this._gateBuffer.length; i++) {
          sum += this._gateBuffer[i] * this._gateBuffer[i];
        }
        const rms = Math.sqrt(sum / this._gateBuffer.length);
        const db = 20 * Math.log10(rms + 1e-6);

        // Threshold sweeps from -72dB to -24dB
        const thresholdDb = -72 + (this.params.gateAmount / 100) * 48;
        const hysteresis = 3.5;

        if (db > thresholdDb) {
          this._gateOpen = true;
        } else if (db < thresholdDb - hysteresis) {
          this._gateOpen = false;
        }

        const targetGain = this._gateOpen ? 1 : 0.008;
        const timeConst = this._gateOpen ? 0.008 : 0.095;
        this.gateGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, timeConst);
      }

      this._gateRaf = requestAnimationFrame(tick);
    };
    this._gateRaf = requestAnimationFrame(tick);
  }

  async enableMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Microphone API unavailable in this browser.');
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    // Stop any previous stream before re-opening
    this.disableMicrophone();

    const constraints = this.router.getMicConstraints(this.rawCaptureMode ? null : false);
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.stream = stream;
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.inputMix);
    this.micLive = true;

    // Refresh device labels now that permission is granted
    await this.router.refreshDevices();
    return true;
  }

  disableMicrophone() {
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch (_) {}
      this.micSource = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    this.micLive = false;
  }

  async toggleMicrophone() {
    if (this.micLive) {
      this.disableMicrophone();
      return false;
    }
    await this.enableMicrophone();
    return true;
  }

  async rebindMicrophoneIfLive() {
    if (this.micLive) {
      await this.enableMicrophone();
    }
  }

  /**
   * Built-in Vocal Synth / Beatbox Audition Trigger so users can hear the DD-6
   * delay, stereo ping-pong, warp/rev, EQ, and hall reverb even without a mic.
   */
  triggerAuditionPhrase() {
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.0, 523.25];

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.13;
      const osc = this.ctx.createOscillator();
      const sub = this.ctx.createOscillator();
      const formant = this.ctx.createBiquadFilter();
      const env = this.ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, start);
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(freq * 0.5, start);

      formant.type = 'bandpass';
      formant.frequency.setValueAtTime(900 + idx * 320, start);
      formant.Q.value = 3.2;

      env.gain.setValueAtTime(0.0001, start);
      env.gain.linearRampToValueAtTime(0.24, start + 0.015);
      env.gain.exponentialRampToValueAtTime(0.0008, start + 0.16);

      osc.connect(formant);
      sub.connect(formant);
      formant.connect(env);
      env.connect(this.inputMix);

      osc.start(start);
      sub.start(start);
      osc.stop(start + 0.18);
      sub.stop(start + 0.18);
    });
  }

  destroy() {
    if (this._gateRaf) {
      cancelAnimationFrame(this._gateRaf);
      this._gateRaf = null;
    }
    this.disableMicrophone();
  }
}
