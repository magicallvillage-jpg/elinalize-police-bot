// سرویس تبلیغات: ساخت/مدیریت پست‌های تبلیغاتی که به‌صورت خودکار و مداوم بعد از N پیام
// در هر گروه فعال ربات فرستاده می‌شوند (N از طریق پنل قابل تنظیم است).
//
// نکته‌ی مهم فنی: Telegram Bot API هیچ امکانی برای تغییر رنگ دکمه‌های شیشه‌ای (inline button)
// در اختیار نمی‌گذارد؛ فقط متن و لینک هر دکمه قابل تنظیم است. این محدودیت خود تلگرام است،
// نه محدودیتی که در این ربات ایجاد شده باشد.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;
const DEFAULT_INTERVAL = 100;

function parseButtons(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function deserializeAd(row) {
  return { ...row, buttons: parseButtons(row.buttons), enabled: Boolean(row.enabled) };
}

/** ساخت یک تبلیغ جدید. buttons: آرایه‌ای از { text, url } (هر کدام روی یک ردیف مستقل نمایش داده می‌شود) */
async function createAd({ content, buttons, createdBy }) {
  const result = await query(`INSERT INTO ${P}ads (content, buttons, enabled, created_by) VALUES (?, ?, TRUE, ?)`, [
    content,
    JSON.stringify(buttons || []),
    createdBy,
  ]);
  return result.insertId;
}

async function listAds() {
  const rows = await query(`SELECT * FROM ${P}ads ORDER BY id DESC`);
  return rows.map(deserializeAd);
}

async function getAd(id) {
  const rows = await query(`SELECT * FROM ${P}ads WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? deserializeAd(rows[0]) : null;
}

async function setEnabled(id, enabled) {
  await query(`UPDATE ${P}ads SET enabled = ? WHERE id = ?`, [enabled, id]);
}

async function deleteAd(id) {
  const result = await query(`DELETE FROM ${P}ads WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

/** تبلیغ‌های فعال - برای انتخاب تصادفی هنگام رسیدن به آستانه‌ی پیام در یک گروه */
async function getEnabledAds() {
  const rows = await query(`SELECT * FROM ${P}ads WHERE enabled = TRUE`);
  return rows.map(deserializeAd);
}

async function getIntervalMessages() {
  const rows = await query(`SELECT interval_messages FROM ${P}ad_settings WHERE id = 1 LIMIT 1`);
  return rows[0] ? rows[0].interval_messages : DEFAULT_INTERVAL;
}

async function setIntervalMessages(n) {
  await query(
    `INSERT INTO ${P}ad_settings (id, interval_messages) VALUES (1, ?)
     ON DUPLICATE KEY UPDATE interval_messages = VALUES(interval_messages)`,
    [n]
  );
}

module.exports = {
  createAd,
  listAds,
  getAd,
  setEnabled,
  deleteAd,
  getEnabledAds,
  getIntervalMessages,
  setIntervalMessages,
};
