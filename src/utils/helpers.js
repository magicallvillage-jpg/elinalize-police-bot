// توابع کمکی عمومی

/**
 * جایگزینی placeholder های {key} داخل یک رشته با مقادیر داده‌شده
 * مثال: format("سلام {name}", { name: "علی" }) => "سلام علی"
 */
function format(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : `{${key}}`
  );
}

/**
 * ساخت یک منشن قابل کلیک (لینک‌دار) از روی یک کاربر تلگرام
 */
function mentionUser(user) {
  if (!user) return 'کاربر ناشناس';
  const name = user.first_name || user.username || String(user.id);
  return `<a href="tg://user?id=${user.id}">${escapeHtml(name)}</a>`;
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * انتخاب تصادفی یک عضو از آرایه (برای دیالوگ‌های تصادفی)
 */
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * عدد تصادفی صحیح بین min و max (شامل هر دو)
 */
function randomIntBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * محدود کردن یک عدد بین یک بازه (برای درصد علاقه/عصبانیت بین ۰ تا ۱۰۰)
 */
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = { format, mentionUser, escapeHtml, pickRandom, randomIntBetween, clamp };
