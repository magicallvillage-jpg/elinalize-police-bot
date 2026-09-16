// سرویس اخراج/بن: نگهداری لیست کاربران اخراج‌شده هر گروه.
// وقتی کاربری اخراج می‌شود در این جدول active=true ثبت می‌شود.
// اگر با هر شرایطی دوباره عضو گروه شد، middleware پیام‌های او را بلافاصله حذف می‌کند
// تا وقتی که یک مقام‌دار دستور "حذف اخراج" را بدهد (active=false).
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

async function banUser(groupId, userId, username, bannedBy) {
  await query(
    `INSERT INTO ${P}banned_users (group_id, user_id, username, banned_by, active)
     VALUES (?, ?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE active = TRUE, banned_by = VALUES(banned_by), username = VALUES(username), banned_at = CURRENT_TIMESTAMP`,
    [groupId, userId, username || null, bannedBy]
  );
}

async function unbanUser(groupId, userId) {
  await query(`UPDATE ${P}banned_users SET active = FALSE WHERE group_id = ? AND user_id = ?`, [groupId, userId]);
}

async function isBanned(groupId, userId) {
  const rows = await query(
    `SELECT * FROM ${P}banned_users WHERE group_id = ? AND user_id = ? AND active = TRUE LIMIT 1`,
    [groupId, userId]
  );
  return Boolean(rows[0]);
}

/** لیست کاربران اخراج‌شده فعال، جدیدترین اول، با صفحه‌بندی برای دکمه شیشه‌ای "بعدی" */
async function listBanned(groupId, offset = 0, limit = 10) {
  return query(
    `SELECT * FROM ${P}banned_users WHERE group_id = ? AND active = TRUE ORDER BY banned_at DESC LIMIT ? OFFSET ?`,
    [groupId, limit, offset]
  );
}

async function countBanned(groupId) {
  const rows = await query(`SELECT COUNT(*) as c FROM ${P}banned_users WHERE group_id = ? AND active = TRUE`, [
    groupId,
  ]);
  return rows[0].c;
}

module.exports = { banUser, unbanUser, isBanned, listBanned, countBanned };
