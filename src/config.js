// تنظیمات مرکزی ربات الینالیزه
// تمام مقادیر حساس از فایل .env خوانده می‌شوند.
require('dotenv').config();

function parseIdList(str) {
  if (!str) return [];
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s));
}

const config = {
  botToken: process.env.BOT_TOKEN,

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  },

  // ادمین‌های مادر: فقط از env خوانده می‌شوند، در دیتابیس ذخیره نمی‌شوند
  // این افراد قابلیت ساخت مقام، تعیین سطح دسترسی هر مقام و دسترسی کامل پنل را دارند
  motherAdminIds: parseIdList(process.env.MOTHER_ADMIN_IDS),

  // پیشوند تمام جداولی که این ربات در دیتابیس مشترک می‌سازد
  tablePrefix: 'elinalize_',

  // کلمات صدا زدن پیش‌فرض ربات - از طریق پنل/دیتابیس هم برای هر گروه قابل تغییر است
  defaultWakeWords: ['الینالیزه', 'لیزه'],

  // تعداد پیش‌فرض اخطار مجاز پیش از اخراج خودکار (هر گروه می‌تواند override کند)
  defaultWarningLimit: 3,

  // تنظیمات سیستم علاقه‌مندی / عصبانیت
  loveAnger: {
    loveIncreasePerAction: 5, // درصد افزایش علاقه با هر ابراز علاقه
    loveCooldownMs: 60 * 60 * 1000, // فاصله مجاز بین دو ابراز علاقه: ۱ ساعت
    angerDailyDecay: 5, // کاهش روزانه عصبانیت
    angerIncreaseOnReport: 10, // افزایش عصبانیت با تایید گزارش
    kickLoveDecrease: 20, // کاهش علاقه با اخراج کاربر توسط مقام‌ها
    kickAngerIncrease: 40, // افزایش عصبانیت با اخراج کاربر توسط مقام‌ها
    specialRankName: 'عزیز الینالیزه',
    specialRankDurationHours: 24,
    specialRankLoveDecreaseAfter: 50, // بعد از اعطای مقام، ۵۰٪ از علاقه کم می‌شود
  },

  // بازه خستگی تصادفی (میلی‌ثانیه) برای دستور "لیزه خسته‌ام"
  tiredMute: {
    minMinutes: 20,
    maxMinutes: 5 * 60,
  },

  // --- قابلیت ۱: کامنت‌گذاری هوش‌مصنوعی روی پست‌های کانال (خاموش/روشن‌شدنی) ---
  channelCommentary: {
    enabled: (process.env.CHANNEL_COMMENTARY_ENABLED || 'false').toLowerCase() === 'true',
    // آیدی عددی کانال (منفی، مثل -1001234567890) - باید ربات ادمین کانال باشد
    channelId: process.env.CHANNEL_ID ? Number(process.env.CHANNEL_ID) : null,
    // چقدر بعد از پست صبر کنیم قبل از کامنت گذاشتن (پیش‌فرض ۲ دقیقه طبق نیازمندی)
    delayMs: Number(process.env.CHANNEL_COMMENTARY_DELAY_MS || 2 * 60 * 1000),
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    // یک مدل رایگان OpenRouter؛ در .env قابل تغییر است
    openRouterModel: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct:free',
  },

  // --- قابلیت ۲: ارسال استیکر (تکی یا چندبخشی) بعد از N پیام در گروه ---
  stickerBurst: {
    enabled: (process.env.STICKER_BURST_ENABLED || 'true').toLowerCase() === 'true',
    messageThreshold: Number(process.env.STICKER_BURST_THRESHOLD || 40),
  },

  // --- قابلیت ۳: شوخی "پام پلیس" بعد از N پیام در گروه ---
  pamPolice: {
    enabled: (process.env.PAM_POLICE_ENABLED || 'true').toLowerCase() === 'true',
    messageThreshold: Number(process.env.PAM_POLICE_THRESHOLD || 60),
    loveIncreaseOnLick: 5,
  },

  logLevel: process.env.LOG_LEVEL || 'info',
};

if (!config.botToken) {
  console.error('خطا: BOT_TOKEN در فایل .env تنظیم نشده است.');
}

module.exports = config;
