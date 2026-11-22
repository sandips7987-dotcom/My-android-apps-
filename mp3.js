/**
 * VoxSynth DD-6 — Stereo MP3 Encoder powered by @breezystack/lamejs (mp3.js)
 */

import { Mp3Encoder } from '@breezystack/lamejs';
import { encodeWavStereo } from './wav.js';

function floatToInt16(floatArr) {
  const out = new Int16Array(floatArr.length);
  for (let i = 0; i < floatArr.length; i++) {
    const s = Math.max(-1, Math.min(1, floatArr[i]));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

export function encodeMp3Stereo(leftChannel, rightChannel, sampleRate = 48000, kbps = 192) {
  try {
    const encoder = new Mp3Encoder(2, sampleRate, kbps);
    const leftInt16 = floatToInt16(leftChannel);
    const rightInt16 = floatToInt16(rightChannel);
    const blockSize = 1152;
    const mp3Chunks = [];

    for (let i = 0; i < leftInt16.length; i += blockSize) {
      const lChunk = leftInt16.subarray(i, i + blockSize);
      const rChunk = rightInt16.subarray(i, i + blockSize);
      const mp3buf = encoder.encodeBuffer(lChunk, rChunk);
      if (mp3buf.length > 0) {
        mp3Chunks.push(new Uint8Array(mp3buf));
      }
    }

    const tail = encoder.flush();
    if (tail.length > 0) {
      mp3Chunks.push(new Uint8Array(tail));
    }

    return {
      blob: new Blob(mp3Chunks, { type: 'audio/mpeg' }),
      ext: 'mp3',
    };
  } catch (err) {
    console.warn('[MP3Encoder] Falling back to WAV:', err);
    return {
      blob: encodeWavStereo(leftChannel, rightChannel, sampleRate),
      ext: 'wav',
    };
  }
}

export async function decodeWavBlobToMp3(wavBlob, kbps = 192) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const arrayBuffer = await wavBlob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    const left = audioBuffer.getChannelData(0);
    const right = audioBuffer.numberOfChannels > 1 ? audioBuffer.getChannelData(1) : left;
    return encodeMp3Stereo(left, right, audioBuffer.sampleRate, kbps);
  } finally {
    await ctx.close();
  }
}
