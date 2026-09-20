// سرویس قابلیت جدید "لیزه میو" (دقیقاً مثل "لیزه سگتم" ولی برای گربه):
// کاربر می‌گوید "لیزه میو" -> لیزه می‌گوید "برام میو میو کن".
// اگر پیام *بعدی* همون کاربر در گروه "میو" یا "میو میو" باشد: ۵٪ علاقه اضافه می‌شود.
// اگر نباشد: ۱۰٪ علاقه کم می‌شود و لیزه به همون پیام بعدی ریپلای می‌زند.
// این چالش برای هر کاربر فقط هر ۱ ساعت یک‌بار قابل شروع است.
//
// جدول جدا (meow_state) دارد تا با چالش «سگتم» قاطی نشود. زمان کول‌داون را خود MySQL حساب می‌کند
// (TIMESTAMPDIFF با NOW()) تا اختلاف منطقه‌ی زمانی بین Node و MySQL مشکلی ایجاد نکند.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;
const COOLDOWN_SEC = 60 * 60; // ۱ ساعت
// «میو» یا «میو میو» یا «میوووو» یا «میو میو میو» ...
const MEOW_ANSWER_REGEX = /^میو+(\s+میو+)*$/;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}meow_state (
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      awaiting BOOLEAN NOT NULL DEFAULT FALSE,
      prompted_at TIMESTAMP NULL DEFAULT NULL,
      attempt_started_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (group_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function getState(groupId, userId) {
  const rows = await query(
    `SELECT *, TIMESTAMPDIFF(SECOND, attempt_started_at, NOW()) AS elapsed_sec
     FROM ${P}meow_state WHERE group_id = ? AND user_id = ? LIMIT 1`,
    [groupId, userId]
  );
  return rows[0] || null;
}

/** تلاش برای شروع چالش. اگر کول‌داون تمام نشده باشد، onCooldown=true برمی‌گردد. */
async function startChallenge(groupId, userId) {
  const state = await getState(groupId, userId);
  if (state && state.attempt_started_at && state.elapsed_sec !== null && Number(state.elapsed_sec) < COOLDOWN_SEC) {
    return { onCooldown: true };
  }

  await query(
    `INSERT INTO ${P}meow_state (group_id, user_id, awaiting, prompted_at, attempt_started_at)
     VALUES (?, ?, TRUE, NOW(), NOW())
     ON DUPLICATE KEY UPDATE awaiting = TRUE, prompted_at = NOW(), attempt_started_at = NOW()`,
    [groupId, userId]
  );
  return { onCooldown: false };
}

/**
 * اگر این کاربر منتظر پاسخ "میو" باشد، پیام فعلی را بررسی می‌کند و وضعیت را می‌بندد.
 * برمی‌گرداند: { consumed: false } یا { consumed: true, success: boolean }
 */
async function consumeIfAwaiting(groupId, userId, text) {
  const state = await getState(groupId, userId);
  if (!state || !state.awaiting) return { consumed: false };

  await query(`UPDATE ${P}meow_state SET awaiting = FALSE WHERE group_id = ? AND user_id = ?`, [groupId, userId]);

  const success = MEOW_ANSWER_REGEX.test((text || '').trim());
  return { consumed: true, success };
}

module.exports = { ensureTable, startChallenge, consumeIfAwaiting, getState };
