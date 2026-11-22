/**
 * VoxSynth DD-6 — Visual Hardware Themes Manager (themes.js)
 * 4 Studio Hardware Themes updating chassis finish, knobs, and OLED backlight.
 */

export const VOXSYNTH_THEMES = [
  {
    id: 'classic',
    nameKey: 'theme_classic',
    fallbackName: 'Classic DD-6 White & Blue',
    statusBarColor: '#11161f',
    swatches: ['#f2f4f7', '#1d4ed8', '#050c14', '#38bdf8'],
  },
  {
    id: 'stealth',
    nameKey: 'theme_stealth',
    fallbackName: 'Stealth Black Studio',
    statusBarColor: '#090b0f',
    swatches: ['#262a33', '#14171d', '#050d0a', '#34d399'],
  },
  {
    id: 'synthwave',
    nameKey: 'theme_synthwave',
    fallbackName: 'Neon Synthwave',
    statusBarColor: '#0b0816',
    swatches: ['#22173d', '#ec4899', '#0a0516', '#22d3ee'],
  },
  {
    id: 'gold',
    nameKey: 'theme_gold',
    fallbackName: 'Vintage Gold',
    statusBarColor: '#120f0b',
    swatches: ['#e8d5a8', '#b89854', '#120b03', '#fbbf24'],
  },
];

const STORAGE_KEY = 'voxsynth_dd6_theme';

export class ThemeManager {
  constructor(onThemeApplied) {
    this.currentTheme = localStorage.getItem(STORAGE_KEY) || 'classic';
    this.onThemeApplied = onThemeApplied || (() => {});
    this.apply(this.currentTheme);
  }

  apply(themeId) {
    const valid = VOXSYNTH_THEMES.find((t) => t.id === themeId) || VOXSYNTH_THEMES[0];
    this.currentTheme = valid.id;

    if (valid.id === 'classic') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', valid.id);
    }

    localStorage.setItem(STORAGE_KEY, valid.id);
    this.onThemeApplied(valid);
    return valid;
  }

  getActive() {
    return VOXSYNTH_THEMES.find((t) => t.id === this.currentTheme) || VOXSYNTH_THEMES[0];
  }
}
