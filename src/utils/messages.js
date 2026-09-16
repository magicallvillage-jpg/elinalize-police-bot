// این ماژول فایل data/messages.json را می‌خواند و با تابع t() امکان
// گرفتن یک پیام با مسیر نقطه‌دار (مثل "rankCommands.kick.success") و
// جایگزینی متغیرهای {name} را فراهم می‌کند.
// چون با require خوانده می‌شود، کافیه بعد از ویرایش JSON ربات را ری‌استارت کنید.
const messages = require('../data/messages.json');
const { format, pickRandom } = require('./helpers');

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

/**
 * گرفتن متن پیام بر اساس مسیر، با جایگزینی متغیرها.
 * اگر مقدار یک آرایه باشد (مثل لیست جملات صبح‌بخیر)، یکی به‌صورت رندوم انتخاب می‌شود.
 */
function t(path, values = {}) {
  const raw = getByPath(messages, path);
  if (raw === undefined) return `[پیام یافت نشد: ${path}]`;
  const chosen = Array.isArray(raw) ? pickRandom(raw) : raw;
  return format(chosen, values);
}

module.exports = { t, allMessages: messages };
