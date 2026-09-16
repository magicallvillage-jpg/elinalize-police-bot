// سرویس اخطار: افزایش/کاهش تعداد اخطار هر کاربر و بررسی رسیدن به سقف اخراج خودکار.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

async function getWarningCount(groupId, userId) {
  const rows = await query(`SELECT count FROM ${P}warnings WHERE group_id = ? AND user_id = ? LIMIT 1`, [
    groupId,
    userId,
  ]);
  return rows[0] ? rows[0].count : 0;
}

/** افزودن یک اخطار و بازگرداندن تعداد جدید */
async function addWarning(groupId, userId) {
  await query(
    `INSERT INTO ${P}warnings (group_id, user_id, count) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    [groupId, userId]
  );
  return getWarningCount(groupId, userId);
}

/** حذف یک اخطار (حداقل صفر) و بازگرداندن تعداد جدید */
async function removeWarning(groupId, userId) {
  const current = await getWarningCount(groupId, userId);
  if (current <= 0) return 0;
  await query(`UPDATE ${P}warnings SET count = GREATEST(count - 1, 0) WHERE group_id = ? AND user_id = ?`, [
    groupId,
    userId,
  ]);
  return current - 1;
}

async function resetWarnings(groupId, userId) {
  await query(`UPDATE ${P}warnings SET count = 0 WHERE group_id = ? AND user_id = ?`, [groupId, userId]);
}

module.exports = { getWarningCount, addWarning, removeWarning, resetWarnings };
