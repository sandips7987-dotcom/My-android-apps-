/**
 * VoxSynth DD-6 — Capacitor Android Native Hooks & Browser Fallbacks (native.js)
 * Integrates KeepAwake, StatusBar, Filesystem export, Native Share, and Haptics.
 */

export class NativeBridge {
  constructor() {
    this.isCapacitor = Boolean(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    this.plugins = (window.Capacitor && window.Capacitor.Plugins) || {};
    this._wakeLock = null;
  }

  async enableKeepAwake() {
    try {
      if (this.plugins.KeepAwake && typeof this.plugins.KeepAwake.keepAwake === 'function') {
        await this.plugins.KeepAwake.keepAwake();
        return true;
      }
      if ('wakeLock' in navigator && navigator.wakeLock) {
        this._wakeLock = await navigator.wakeLock.request('screen');
        return true;
      }
    } catch (err) {
      console.warn('[NativeBridge] KeepAwake skipped:', err.message);
    }
    return false;
  }

  async setStatusBarColor(hexColor = '#11161f', darkContent = false) {
    try {
      if (this.plugins.StatusBar) {
        if (typeof this.plugins.StatusBar.setBackgroundColor === 'function') {
          await this.plugins.StatusBar.setBackgroundColor({ color: hexColor });
        }
        if (typeof this.plugins.StatusBar.setStyle === 'function') {
          await this.plugins.StatusBar.setStyle({ style: darkContent ? 'LIGHT' : 'DARK' });
        }
      }
      let metaTheme = document.querySelector('meta[name="theme-color"]');
      if (!metaTheme) {
        metaTheme = document.createElement('meta');
        metaTheme.name = 'theme-color';
        document.head.appendChild(metaTheme);
      }
      metaTheme.content = hexColor;
    } catch (err) {
      console.warn('[NativeBridge] StatusBar sync skipped:', err.message);
    }
  }

  async hapticTap(intensity = 'light') {
    try {
      if (this.plugins.Haptics && typeof this.plugins.Haptics.impact === 'function') {
        const style = intensity === 'heavy' ? 'HEAVY' : intensity === 'medium' ? 'MEDIUM' : 'LIGHT';
        await this.plugins.Haptics.impact({ style });
        return;
      }
      if (navigator.vibrate) {
        navigator.vibrate(intensity === 'heavy' ? 24 : intensity === 'medium' ? 14 : 8);
      }
    } catch (_) {}
  }

  async saveAudioFile(blob, filename) {
    // 1. Capacitor Android Filesystem (Documents/VoxSynthDD6/<filename>)
    if (this.isCapacitor && this.plugins.Filesystem && typeof this.plugins.Filesystem.writeFile === 'function') {
      const base64Data = await this._blobToBase64(blob);
      const path = `VoxSynthDD6/${filename}`;
      const result = await this.plugins.Filesystem.writeFile({
        path,
        data: base64Data,
        directory: 'DOCUMENTS',
        recursive: true,
      });
      return { savedNative: true, uri: result.uri, path };
    }

    // 2. Browser Direct Download Fallback
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { savedNative: false, path: filename };
  }

  async shareAudioFile(blob, filename, title = 'VoxSynth DD-6 Recording') {
    // 1. Capacitor Android Native Share
    if (this.isCapacitor && this.plugins.Filesystem && this.plugins.Share) {
      const saved = await this.saveAudioFile(blob, filename);
      await this.plugins.Share.share({
        title,
        text: `Recorded with VoxSynth DD-6 (${filename})`,
        url: saved.uri,
        dialogTitle: 'Share Recording',
      });
      return true;
    }

    // 2. Web Share API (Level 2 File Share)
    const file = new File([blob], filename, { type: blob.type || 'audio/wav' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        title,
        text: 'Recorded with VoxSynth DD-6',
        files: [file],
      });
      return true;
    }

    // 3. Fallback: Save / Download file
    await this.saveAudioFile(blob, filename);
    return false;
  }

  _blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = String(reader.result || '');
        const commaIdx = dataUrl.indexOf(',');
        resolve(commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}
