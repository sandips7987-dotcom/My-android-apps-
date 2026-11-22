/**
 * VoxSynth DD-6 — Multi-Language & RTL Localization Engine (i18n.js)
 * Supports English (en), Hindi (hi - हिन्दी), and Arabic (ar - العربية RTL).
 */

export const TRANSLATIONS = {
  en: {
    dir: 'ltr',
    langName: 'EN',
    nav_deck: 'Track Deck',
    nav_library: 'Library',
    nav_themes: 'Themes',
    nav_pin: 'PIN Lock',
    nav_guide: 'Guide',
    nav_pro: 'Pro Unlock',
    nav_pro_unlocked: 'Pro Active',

    io_title: 'Audio I/O & Hardware Router',
    io_wired_title: '3.5mm Wired',
    io_wired_sub: 'Ultra-Low Latency',
    io_bt_title: 'Bluetooth',
    io_bt_sub: 'BT Sync & Anti-FB',
    io_input_label: 'Microphone Input',
    io_output_label: 'Audio Output Sink',
    io_bt_sync: 'Bluetooth Latency Sync Offset',
    io_bt_mic_source: 'Bluetooth Vocal Mic Source',
    io_bt_mic_phone: 'Phone Built-in Mic + BT A2DP Speaker',
    io_bt_mic_headset: 'Bluetooth Headset Mic',
    io_anti_fb: 'Bluetooth Anti-Feedback Filter',
    io_refresh: 'Rescan Devices',

    deck_title: 'Backing Track Overdub Deck',
    deck_upload: 'Upload Track',
    deck_demo: 'Load Studio Groove',
    deck_play: 'Play',
    deck_pause: 'Pause',
    deck_stop: 'Stop',
    deck_loop: 'Loop',
    deck_vol: 'Track Vol',
    deck_fx_dry: 'Track FX: Dry',
    deck_fx_wet: 'Track FX: DD-6 On',
    deck_no_track: 'No backing track loaded (.MP3, .WAV, .OGG, .M4A)',

    lib_title: 'Saved Recordings Library',
    lib_empty: 'No recordings yet. Press REC on the pedal to capture live vocals + backing track.',
    lib_play: 'Play',
    lib_stop: 'Stop',
    lib_rename: 'Rename',
    lib_wav: 'WAV',
    lib_mp3: 'MP3',
    lib_share: 'Share',
    lib_delete: 'Delete',

    btn_tap: 'TAP TEMPO',
    btn_mic: 'MIC LIVE',
    btn_route_wired: '3.5MM MODE',
    btn_route_bt: 'BT MODE',
    btn_pingpong: 'PING-PONG',
    btn_rec: 'REC',
    btn_pause: 'PAUSE',
    btn_stop: 'STOP',
    btn_test: 'TEST TONE',

    stomp_sub_active: 'TAP TO BYPASS',
    stomp_sub_bypass: 'TAP TO ENGAGE',
    stomp_sub_hold_idle: 'TAP TO RECORD LOOP (5.2s)',
    stomp_sub_hold_rec: 'TAP TO LOOP PLAYBACK',
    stomp_sub_hold_play: 'TAP TO CLEAR LOOP',

    modal_themes: 'Hardware Visual Themes',
    theme_classic: 'Classic DD-6 White & Blue',
    theme_stealth: 'Stealth Black Studio',
    theme_synthwave: 'Neon Synthwave',
    theme_gold: 'Vintage Gold',

    modal_guide: 'VoxSynth DD-6 Quick Studio Guide',
    modal_pin: '4-Digit Studio PIN Security',
    modal_pro: 'VoxSynth DD-6 Pro License',
    pin_enter: 'Enter 4-Digit PIN to Unlock',
    pin_status_on: 'Startup PIN Lock is ENABLED',
    pin_status_off: 'Startup PIN Lock is DISABLED',
    pin_save: 'Enable / Update PIN',
    pin_disable: 'Disable PIN Lock',
    pin_lock_now: 'Lock Now',

    pro_device_id: 'Your Offline Device ID',
    pro_copy: 'Copy ID',
    pro_key_label: 'Enter Offline Activation Key',
    pro_activate: 'Verify & Unlock Pro',
    pro_qr_hint: 'Scan QR to purchase Pro License, then send your Device ID to receive your offline unlock key.',
  },

  hi: {
    dir: 'ltr',
    langName: 'हिन्दी',
    nav_deck: 'ट्रैक डेक',
    nav_library: 'रिकॉर्डिंग्स',
    nav_themes: 'थीम्स',
    nav_pin: 'पिन लॉक',
    nav_guide: 'गाइड',
    nav_pro: 'प्रो अनलॉक',
    nav_pro_unlocked: 'प्रो सक्रिय',

    io_title: 'ऑडियो I/O और हार्डवेयर राउटर',
    io_wired_title: '3.5mm वायर्ड',
    io_wired_sub: 'अल्ट्रा-लो लेटेंसी',
    io_bt_title: 'ब्लूटूथ',
    io_bt_sub: 'BT सिंक व एंटी-फीडबैक',
    io_input_label: 'माइक्रोफ़ोन इनपुट',
    io_output_label: 'ऑडियो आउटपुट डिवाइस',
    io_bt_sync: 'ब्लूटूथ लेटेंसी सिंक ऑफसेट',
    io_bt_mic_source: 'ब्लूटूथ वोकल माइक स्रोत',
    io_bt_mic_phone: 'फ़ोन माइक + ब्लूटूथ A2DP स्पीकर',
    io_bt_mic_headset: 'ब्लूटूथ हेडसेट माइक',
    io_anti_fb: 'ब्लूटूथ एंटी-फीडबैक फ़िल्टर',
    io_refresh: 'डिवाइस स्कैन करें',

    deck_title: 'बैकिंग ट्रैक ओवरडब डेक',
    deck_upload: 'ट्रैक अपलोड करें',
    deck_demo: 'स्टूडियो ग्रूव चलाएँ',
    deck_play: 'प्ले',
    deck_pause: 'पॉज़',
    deck_stop: 'स्टॉप',
    deck_loop: 'लूप',
    deck_vol: 'ट्रैक वॉल्यूम',
    deck_fx_dry: 'ट्रैक FX: ड्राई',
    deck_fx_wet: 'ट्रैक FX: DD-6 ऑन',
    deck_no_track: 'कोई बैकिंग ट्रैक लोड नहीं (.MP3, .WAV, .OGG, .M4A)',

    lib_title: 'सहेजी गई रिकॉर्डिंग लाइब्रेरी',
    lib_empty: 'अभी कोई रिकॉर्डिंग नहीं। लाइव वोकल और ट्रैक रिकॉर्ड करने के लिए REC दबाएँ।',
    lib_play: 'प्ले',
    lib_stop: 'स्टॉप',
    lib_rename: 'नाम बदलें',
    lib_wav: 'WAV',
    lib_mp3: 'MP3',
    lib_share: 'शेयर',
    lib_delete: 'हटाएँ',

    btn_tap: 'टैप टेम्पो',
    btn_mic: 'माइक लाइव',
    btn_route_wired: '3.5MM मोड',
    btn_route_bt: 'BT मोड',
    btn_pingpong: 'पिंग-पोंग',
    btn_rec: 'रिकॉर्ड',
    btn_pause: 'पॉज़',
    btn_stop: 'स्टॉप',
    btn_test: 'टेस्ट टोन',

    stomp_sub_active: 'बायपास के लिए दबाएँ',
    stomp_sub_bypass: 'सक्रिय करने के लिए दबाएँ',
    stomp_sub_hold_idle: 'लूप रिकॉर्ड करें (5.2s)',
    stomp_sub_hold_rec: 'लूप प्ले करने के लिए दबाएँ',
    stomp_sub_hold_play: 'लूप साफ़ करने के लिए दबाएँ',

    modal_themes: 'हार्डवेयर विज़ुअल थीम्स',
    theme_classic: 'क्लासिक DD-6 व्हाइट और ब्लू',
    theme_stealth: 'स्टील्थ ब्लैक स्टूडियो',
    theme_synthwave: 'नियॉन सिंथवेव',
    theme_gold: 'विंटेज गोल्ड',

    modal_guide: 'VoxSynth DD-6 स्टूडियो गाइड',
    modal_pin: '4-अंकीय पिन सुरक्षा',
    modal_pro: 'VoxSynth DD-6 प्रो लाइसेंस',
    pin_enter: 'अनलॉक करने के लिए 4-अंकीय पिन दर्ज करें',
    pin_status_on: 'स्टार्टअप पिन लॉक चालू है',
    pin_status_off: 'स्टार्टअप पिन लॉक बंद है',
    pin_save: 'पिन चालू / अपडेट करें',
    pin_disable: 'पिन लॉक बंद करें',
    pin_lock_now: 'अभी लॉक करें',

    pro_device_id: 'आपका ऑफ़लाइन डिवाइस ID',
    pro_copy: 'ID कॉपी करें',
    pro_key_label: 'ऑफ़लाइन एक्टिवेशन कुंजी दर्ज करें',
    pro_activate: 'सत्यापित करें और अनलॉक करें',
    pro_qr_hint: 'प्रो लाइसेंस के लिए QR स्कैन करें और अपनी ऑफ़लाइन कुंजी प्राप्त करने के लिए डिवाइस ID भेजें।',
  },

  ar: {
    dir: 'rtl',
    langName: 'العربية',
    nav_deck: 'المسار الخلفي',
    nav_library: 'المكتبة',
    nav_themes: 'المظاهر',
    nav_pin: 'قفل PIN',
    nav_guide: 'الدليل',
    nav_pro: 'فتح برو',
    nav_pro_unlocked: 'برو مفعل',

    io_title: 'موجه الصوت والمنافذ',
    io_wired_title: 'سلكي 3.5mm',
    io_wired_sub: 'زمن استجابة فائق',
    io_bt_title: 'بلوتوث',
    io_bt_sub: 'مزامنة ومنع الصدى',
    io_input_label: 'مدخل الميكروفون',
    io_output_label: 'مخرج الصوت',
    io_bt_sync: 'مزامنة تأخير البلوتوث',
    io_bt_mic_source: 'مصدر ميكروفون البلوتوث',
    io_bt_mic_phone: 'ميكروفون الهاتف + سماعة بلوتوث A2DP',
    io_bt_mic_headset: 'ميكروفون سماعة البلوتوث',
    io_anti_fb: 'مرشح منع الارتداد للبلوتوث',
    io_refresh: 'فحص الأجهزة',

    deck_title: 'مشغل المسار الخلفي والتسجيل',
    deck_upload: 'رفع مسار',
    deck_demo: 'إيقاع استوديو تجريبي',
    deck_play: 'تشغيل',
    deck_pause: 'إيقاف مؤقت',
    deck_stop: 'إيقاف',
    deck_loop: 'تكرار',
    deck_vol: 'مستوى المسار',
    deck_fx_dry: 'المؤثر: صوت نقي',
    deck_fx_wet: 'المؤثر: DD-6 مفعل',
    deck_no_track: 'لم يتم تحميل مسار صوتي (.MP3, .WAV, .OGG, .M4A)',

    lib_title: 'مكتبة التسجيلات المحفوظة',
    lib_empty: 'لا توجد تسجيلات بعد. اضغط REC على الدواسة لتسجيل الصوت مع المسار.',
    lib_play: 'تشغيل',
    lib_stop: 'إيقاف',
    lib_rename: 'تسمية',
    lib_wav: 'WAV',
    lib_mp3: 'MP3',
    lib_share: 'مشاركة',
    lib_delete: 'حذف',

    btn_tap: 'إيقاع النقر',
    btn_mic: 'الميكروفون',
    btn_route_wired: 'وضع 3.5MM',
    btn_route_bt: 'وضع بلوتوث',
    btn_pingpong: 'بنج بونج',
    btn_rec: 'تسجيل',
    btn_pause: 'مؤقت',
    btn_stop: 'إيقاف',
    btn_test: 'نغمة اختبار',

    stomp_sub_active: 'اضغط للتجاوز',
    stomp_sub_bypass: 'اضغط للتفعيل',
    stomp_sub_hold_idle: 'اضغط لتسجيل حلقة (5.2ث)',
    stomp_sub_hold_rec: 'اضغط لتشغيل الحلقة',
    stomp_sub_hold_play: 'اضغط لمسح الحلقة',

    modal_themes: 'مظاهر الجهاز',
    theme_classic: 'كلاسيك DD-6 أبيض وأزرق',
    theme_stealth: 'أسود ستيلث استوديو',
    theme_synthwave: 'نيون سينثويف',
    theme_gold: 'ذهبي كلاسيكي',

    modal_guide: 'دليل VoxSynth DD-6 السريع',
    modal_pin: 'حماية رمز PIN من 4 أرقام',
    modal_pro: 'ترخيص VoxSynth DD-6 برو',
    pin_enter: 'أدخل رمز PIN لفتح التطبيق',
    pin_status_on: 'قفل PIN عند التشغيل مفعل',
    pin_status_off: 'قفل PIN عند التشغيل معطل',
    pin_save: 'تفعيل / تحديث PIN',
    pin_disable: 'تعطيل قفل PIN',
    pin_lock_now: 'قفل الآن',

    pro_device_id: 'معرف الجهاز دون اتصال',
    pro_copy: 'نسخ المعرف',
    pro_key_label: 'أدخل مفتاح التفعيل دون اتصال',
    pro_activate: 'تحقق وفتح برو',
    pro_qr_hint: 'امسح رمز QR لشراء ترخيص برو، ثم أرسل معرف الجهاز لاستلام مفتاح التفعيل.',
  },
};

const LANG_KEY = 'voxsynth_dd6_lang';

export class I18nManager {
  constructor(onLanguageChange) {
    this.lang = localStorage.getItem(LANG_KEY) || 'en';
    if (!TRANSLATIONS[this.lang]) this.lang = 'en';
    this.onLanguageChange = onLanguageChange || (() => {});
  }

  t(key) {
    const dict = TRANSLATIONS[this.lang] || TRANSLATIONS.en;
    return dict[key] || TRANSLATIONS.en[key] || key;
  }

  setLanguage(langCode) {
    if (!TRANSLATIONS[langCode]) return;
    this.lang = langCode;
    localStorage.setItem(LANG_KEY, langCode);
    this.applyToDOM();
    this.onLanguageChange(langCode);
  }

  cycleLanguage() {
    const order = ['en', 'hi', 'ar'];
    const next = order[(order.indexOf(this.lang) + 1) % order.length];
    this.setLanguage(next);
    return next;
  }

  applyToDOM() {
    const dict = TRANSLATIONS[this.lang] || TRANSLATIONS.en;
    document.documentElement.lang = this.lang;
    document.documentElement.dir = dict.dir;

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key && dict[key]) {
        el.textContent = dict[key];
      }
    });
  }
}
