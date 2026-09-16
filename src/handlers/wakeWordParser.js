// این ماژول بررسی می‌کند آیا پیام با یکی از کلمات صدا زدن ربات (مثل "لیزه" یا "الینالیزه") شروع شده،
// و در صورت مثبت بودن، باقی متن (خود دستور) را برمی‌گرداند.
// طبق نیازمندی، امکان افزودن/تغییر کلمات صدا زدن در کد (و همچنین در دیتابیس هر گروه) وجود دارد؛
// در نبود تنظیمات دیتابیسی، لیست پیش‌فرض از config.defaultWakeWords استفاده می‌شود.
const groupSettingsService = require('../services/groupSettingsService');

/**
 * بررسی می‌کند که آیا متن با یکی از کلمات صدا زدن شروع شده است.
 * برمی‌گرداند: { matched: boolean, wakeWord, rest }
 */
async function extractCommand(groupId, text) {
  if (!text) return { matched: false };
  const settings = await groupSettingsService.getSettings(groupId);
  const trimmed = text.trim();

  // کلمات صدا زدن را از طولانی‌ترین به کوتاه‌ترین مرتب می‌کنیم تا تطبیق دقیق‌تری داشته باشیم
  const wakeWords = [...settings.wake_words].sort((a, b) => b.length - a.length);

  for (const word of wakeWords) {
    if (trimmed === word) {
      return { matched: true, wakeWord: word, rest: '' };
    }
    if (trimmed.startsWith(word + ' ')) {
      return { matched: true, wakeWord: word, rest: trimmed.slice(word.length).trim() };
    }
  }
  return { matched: false };
}

module.exports = { extractCommand };
