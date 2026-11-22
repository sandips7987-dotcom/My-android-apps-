/**
 * VoxSynth DD-6 — Master Bus Recorder & IndexedDB Recordings Library (media.js)
 * Captures the combined stereo master mix (Backing Track + Live Mic + DD-6 FX)
 * with REC / PAUSE / STOP, stores lossless WAV in IndexedDB, and exports WAV or MP3.
 */

import { encodeWavStereo, mergeFloat32Chunks } from './wav.js';
import { decodeWavBlobToMp3 } from './mp3.js';
import { formatTimeMMSS } from './track-player.js';

const DB_NAME = 'VoxSynthDD6_Library';
const DB_VERSION = 1;
const STORE_NAME = 'recordings';

export class MasterMediaLibrary {
  constructor(audioContext, masterSourceNode) {
    this.ctx = audioContext;
    this.masterSourceNode = masterSourceNode;

    this.isRecording = false;
    this.isPaused = false;
    this.elapsedSec = 0;

    this._chunksL = [];
    this._chunksR = [];
    this._totalSamples = 0;
    this._captureNode = null;
    this._silentSink = null;
    this._timerInterval = null;
    this._onStatusChange = null;
    this._db = null;

    this._previewAudio = new Audio();
    this._playingId = null;
  }

  onStatusChange(cb) {
    this._onStatusChange = cb;
  }

  _emitStatus() {
    if (this._onStatusChange) {
      this._onStatusChange({
        isRecording: this.isRecording,
        isPaused: this.isPaused,
        elapsedSec: this.elapsedSec,
        formatted: formatTimeMMSS(this.elapsedSec),
      });
    }
  }

  async openDB() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };
      req.onsuccess = (e) => {
        this._db = e.target.result;
        resolve(this._db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async startRecording() {
    if (this.isRecording) {
      if (this.isPaused) {
        this.isPaused = false;
        this._emitStatus();
      }
      return;
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    this._chunksL = [];
    this._chunksR = [];
    this._totalSamples = 0;
    this.elapsedSec = 0;
    this.isRecording = true;
    this.isPaused = false;

    this._captureNode = this.ctx.createScriptProcessor(4096, 2, 2);
    this._silentSink = this.ctx.createGain();
    this._silentSink.gain.value = 0;

    this._captureNode.onaudioprocess = (event) => {
      if (!this.isRecording || this.isPaused) return;
      const inL = event.inputBuffer.getChannelData(0);
      const inR = event.inputBuffer.numberOfChannels > 1
        ? event.inputBuffer.getChannelData(1)
        : inL;

      const copyL = new Float32Array(inL.length);
      const copyR = new Float32Array(inR.length);
      copyL.set(inL);
      copyR.set(inR);

      this._chunksL.push(copyL);
      this._chunksR.push(copyR);
      this._totalSamples += inL.length;
    };

    this.masterSourceNode.connect(this._captureNode);
    this._captureNode.connect(this._silentSink);
    this._silentSink.connect(this.ctx.destination);

    this._timerInterval = setInterval(() => {
      if (this.isRecording && !this.isPaused) {
        this.elapsedSec = this._totalSamples / this.ctx.sampleRate;
        this._emitStatus();
      }
    }, 200);

    this._emitStatus();
  }

  togglePause() {
    if (!this.isRecording) return false;
    this.isPaused = !this.isPaused;
    this._emitStatus();
    return this.isPaused;
  }

  async stopAndSave(meta = {}) {
    if (!this.isRecording) return null;

    this.isRecording = false;
    this.isPaused = false;

    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }

    if (this._captureNode) {
      try {
        this.masterSourceNode.disconnect(this._captureNode);
        this._captureNode.disconnect();
      } catch (_) {}
      this._captureNode = null;
    }

    if (this._silentSink) {
      try {
        this._silentSink.disconnect();
      } catch (_) {}
      this._silentSink = null;
    }

    this._emitStatus();

    if (this._totalSamples < 512) {
      return null;
    }

    const left = mergeFloat32Chunks(this._chunksL, this._totalSamples);
    const right = mergeFloat32Chunks(this._chunksR, this._totalSamples);
    const wavBlob = encodeWavStereo(left, right, this.ctx.sampleRate);
    const duration = this._totalSamples / this.ctx.sampleRate;

    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const defaultTitle = `VoxSynth Take ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const record = {
      id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: meta.name || defaultTitle,
      createdAt: Date.now(),
      duration,
      sampleRate: this.ctx.sampleRate,
      sizeBytes: wavBlob.size,
      delayMs: meta.delayMs || 420,
      mode: meta.mode || 'MEDIUM',
      blob: wavBlob,
    };

    await this.saveRecord(record);
    this._chunksL = [];
    this._chunksR = [];
    this._totalSamples = 0;

    return record;
  }

  async saveRecord(record) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    });
  }

  async listRecordings() {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => {
        const items = (req.result || []).sort((a, b) => b.createdAt - a.createdAt);
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getRecording(id) {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async renameRecording(id, newName) {
    const trimmed = String(newName || '').trim();
    if (!trimmed) return null;
    const rec = await this.getRecording(id);
    if (!rec) return null;
    rec.name = trimmed;
    await this.saveRecord(rec);
    return rec;
  }

  async deleteRecording(id) {
    if (this._playingId === id) {
      this.stopPreview();
    }
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  async togglePlayPreview(id, onEnded) {
    if (this._playingId === id && !this._previewAudio.paused) {
      this.stopPreview();
      return false;
    }

    this.stopPreview();
    const rec = await this.getRecording(id);
    if (!rec || !rec.blob) return false;

    const url = URL.createObjectURL(rec.blob);
    this._previewAudio.src = url;
    this._playingId = id;

    this._previewAudio.onended = () => {
      URL.revokeObjectURL(url);
      this._playingId = null;
      if (onEnded) onEnded();
    };

    await this._previewAudio.play();
    return true;
  }

  stopPreview() {
    try {
      this._previewAudio.pause();
      this._previewAudio.currentTime = 0;
    } catch (_) {}
    this._playingId = null;
  }

  getPlayingId() {
    return this._playingId;
  }

  async exportAsMp3(id) {
    const rec = await this.getRecording(id);
    if (!rec || !rec.blob) throw new Error('Recording not found');
    const result = await decodeWavBlobToMp3(rec.blob, 192);
    const safeName = rec.name.replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'voxsynth_take';
    return {
      blob: result.blob,
      filename: `${safeName}.${result.ext}`,
    };
  }

  async exportAsWav(id) {
    const rec = await this.getRecording(id);
    if (!rec || !rec.blob) throw new Error('Recording not found');
    const safeName = rec.name.replace(/[^a-z0-9_\- ]/gi, '_').trim() || 'voxsynth_take';
    return {
      blob: rec.blob,
      filename: `${safeName}.wav`,
    };
  }
}
