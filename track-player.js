/**
 * VoxSynth DD-6 — Backing Track Upload & Live Overdub Deck (track-player.js)
 * Supports MP3, WAV, OGG, M4A playback, seek scrubbing, loop toggle, TRACK VOL,
 * TRACK FX routing (Clean/Dry vs DD-6 FX Bus), and a built-in synth backing groove generator.
 */

export class BackingTrackDeck {
  constructor(audioContext, engine) {
    this.ctx = audioContext;
    this.engine = engine;

    this.audioBuffer = null;
    this.trackName = '';
    this.isPlaying = false;
    this.isLooping = true;
    this.volume = 0.75; // 0..1
    this.routeToFx = false; // false = Clean/Dry direct to master; true = Through DD-6 FX

    this._source = null;
    this._startedAt = 0;
    this._pauseOffset = 0;
    this._onUpdate = null;
    this._ticker = null;

    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = this.volume;

    this._connectRouting();
  }

  onUpdate(callback) {
    this._onUpdate = callback;
  }

  _emit() {
    if (this._onUpdate) {
      this._onUpdate(this.getState());
    }
  }

  getState() {
    return {
      loaded: Boolean(this.audioBuffer),
      trackName: this.trackName,
      isPlaying: this.isPlaying,
      isLooping: this.isLooping,
      volume: this.volume,
      routeToFx: this.routeToFx,
      currentTime: this.getCurrentTime(),
      duration: this.audioBuffer ? this.audioBuffer.duration : 0,
    };
  }

  _connectRouting() {
    try {
      this.gainNode.disconnect();
    } catch (_) {}

    if (this.routeToFx) {
      // Apply DD-6 Delay/Warp/Hold effects to both Backing Track and Voice
      this.gainNode.connect(this.engine.fxInput);
    } else {
      // Keep Backing Track clean/dry while only live mic gets DD-6 echo
      this.gainNode.connect(this.engine.backingDryBus);
    }
  }

  setRouteToFx(enabled) {
    this.routeToFx = Boolean(enabled);
    this._connectRouting();
    this._emit();
  }

  toggleRouteToFx() {
    this.setRouteToFx(!this.routeToFx);
    return this.routeToFx;
  }

  setVolume(val) {
    const clamped = Math.max(0, Math.min(1, Number(val)));
    this.volume = clamped;
    this.gainNode.gain.setTargetAtTime(clamped, this.ctx.currentTime, 0.015);
    this._emit();
  }

  setLoop(enabled) {
    this.isLooping = Boolean(enabled);
    if (this._source) {
      this._source.loop = this.isLooping;
    }
    this._emit();
  }

  toggleLoop() {
    this.setLoop(!this.isLooping);
    return this.isLooping;
  }

  async loadFile(file) {
    if (!file) return false;
    this.stop();
    const arrayBuffer = await file.arrayBuffer();
    const decoded = await this.ctx.decodeAudioData(arrayBuffer);
    this.audioBuffer = decoded;
    this.trackName = file.name;
    this._pauseOffset = 0;
    this._emit();
    return true;
  }

  /**
   * Generates a warm 4-bar 100 BPM studio drum & electric-piano groove in memory
   * so users can immediately test vocal overdubbing without locating a local audio file.
   */
  loadBuiltInStudioGroove() {
    this.stop();
    const sr = this.ctx.sampleRate;
    const bpm = 100;
    const beatSec = 60 / bpm;
    const duration = beatSec * 16; // 4 bars
    const totalSamples = Math.floor(sr * duration);
    const buffer = this.ctx.createBuffer(2, totalSamples, sr);
    const chL = buffer.getChannelData(0);
    const chR = buffer.getChannelData(1);

    const chords = [
      [220.0, 261.63, 329.63, 392.0], // Am7
      [174.61, 220.0, 261.63, 329.63], // Fmaj7
      [196.0, 246.94, 293.66, 392.0], // G6
      [164.81, 196.0, 246.94, 293.66], // Em7
    ];

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sr;
      const beatPos = t / beatSec;
      const barIdx = Math.floor(beatPos / 4) % 4;
      const beatInBar = beatPos % 4;
      const beatFrac = beatPos % 1;

      // Warm electric piano chord pad
      let pad = 0;
      const chord = chords[barIdx];
      const barFrac = (beatPos % 4) / 4;
      const padEnv = Math.min(1, barFrac * 14) * Math.exp(-barFrac * 1.4);
      for (let c = 0; c < chord.length; c++) {
        pad += Math.sin(2 * Math.PI * chord[c] * t) * 0.08 * padEnv;
      }

      // Soft Kick on beats 0 and 2.5
      let kick = 0;
      const kickT = beatInBar < 2.5 ? beatInBar : beatInBar - 2.5;
      if ((beatInBar < 0.35 || (beatInBar >= 2.5 && beatInBar < 2.85)) && kickT >= 0) {
        const kEnv = Math.exp(-kickT * 18);
        const kFreq = 48 + 95 * Math.exp(-kickT * 36);
        kick = Math.sin(2 * Math.PI * kFreq * kickT) * 0.36 * kEnv;
      }

      // Crisp Snare on beats 1 and 3
      let snare = 0;
      if ((beatInBar >= 1 && beatInBar < 1.25) || (beatInBar >= 3 && beatInBar < 3.25)) {
        const sT = beatInBar >= 3 ? beatInBar - 3 : beatInBar - 1;
        const sEnv = Math.exp(-sT * 26);
        snare = ((Math.random() * 2 - 1) * 0.16 + Math.sin(2 * Math.PI * 190 * sT) * 0.12) * sEnv;
      }

      // Subtle eighth-note hi-hat
      const eighthFrac = (beatPos * 2) % 1;
      const hat = eighthFrac < 0.08 ? (Math.random() * 2 - 1) * 0.04 * Math.exp(-eighthFrac * 45) : 0;

      const mixL = (pad * 0.92 + kick + snare * 0.95 + hat * 0.8) * 0.85;
      const mixR = (pad * 1.04 + kick + snare * 1.05 + hat * 1.15) * 0.85;

      chL[i] = Math.max(-0.95, Math.min(0.95, mixL));
      chR[i] = Math.max(-0.95, Math.min(0.95, mixR));
    }

    this.audioBuffer = buffer;
    this.trackName = 'Studio Demo — Neo-Soul 100 BPM.wav';
    this._pauseOffset = 0;
    this._emit();
  }

  getCurrentTime() {
    if (!this.audioBuffer) return 0;
    if (!this.isPlaying) return Math.min(this._pauseOffset, this.audioBuffer.duration);
    const elapsed = this.ctx.currentTime - this._startedAt;
    const raw = this._pauseOffset + elapsed;
    return this.isLooping ? raw % this.audioBuffer.duration : Math.min(raw, this.audioBuffer.duration);
  }

  async play() {
    if (!this.audioBuffer) return false;
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this._stopSourceOnly();

    const src = this.ctx.createBufferSource();
    src.buffer = this.audioBuffer;
    src.loop = this.isLooping;
    src.connect(this.gainNode);

    const offset = this._pauseOffset % this.audioBuffer.duration;
    src.start(0, offset);
    this._source = src;
    this._startedAt = this.ctx.currentTime;
    this.isPlaying = true;

    src.onended = () => {
      if (this._source === src && !this.isLooping) {
        this.isPlaying = false;
        this._pauseOffset = 0;
        this._stopTicker();
        this._emit();
      }
    };

    this._startTicker();
    this._emit();
    return true;
  }

  pause() {
    if (!this.isPlaying || !this.audioBuffer) return;
    this._pauseOffset = this.getCurrentTime();
    this._stopSourceOnly();
    this.isPlaying = false;
    this._stopTicker();
    this._emit();
  }

  stop() {
    this._stopSourceOnly();
    this.isPlaying = false;
    this._pauseOffset = 0;
    this._stopTicker();
    this._emit();
  }

  seek(seconds) {
    if (!this.audioBuffer) return;
    const clamped = Math.max(0, Math.min(this.audioBuffer.duration - 0.01, Number(seconds) || 0));
    this._pauseOffset = clamped;
    if (this.isPlaying) {
      this.play();
    } else {
      this._emit();
    }
  }

  _stopSourceOnly() {
    if (this._source) {
      const old = this._source;
      this._source = null;
      old.onended = null;
      try {
        old.stop();
        old.disconnect();
      } catch (_) {}
    }
  }

  _startTicker() {
    this._stopTicker();
    this._ticker = setInterval(() => this._emit(), 120);
  }

  _stopTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  destroy() {
    this.stop();
  }
}

export function formatTimeMMSS(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const mins = String(Math.floor(s / 60)).padStart(2, '0');
  const secs = String(s % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}
