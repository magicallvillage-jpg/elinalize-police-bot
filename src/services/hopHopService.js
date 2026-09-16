// سرویس قابلیت جدید "لیزه سگتم":
// کاربر می‌گوید "لیزه سگتم" -> لیزه می‌گوید "برام هاپ هاپ کن".
// اگر پیام *بعدی* همون کاربر در گروه "هاپ هاپ" یا "هاپ" باشد: ۵٪ علاقه اضافه می‌شود.
// اگر نباشد: ۱۰٪ علاقه کم می‌شود و لیزه به همون پیام بعدی ریپلای می‌زند.
// این چالش برای هر کاربر فقط هر ۱ ساعت یک‌بار قابل شروع است.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;
const COOLDOWN_MS = 60 * 60 * 1000; // ۱ ساعت
const HOP_ANSWER_REGEX = /^(هاپ\s*هاپ|هاپ)$/;

async function getState(groupId, userId) {
  const rows = await query(`SELECT * FROM ${P}hop_state WHERE group_id = ? AND user_id = ? LIMIT 1`, [
    groupId,
    userId,
  ]);
  return rows[0] || null;
}

/**
 * تلاش برای شروع چالش. اگر کول‌داون تمام نشده باشد، onCooldown=true برمی‌گردد.
 */
async function startChallenge(groupId, userId) {
  const state = await getState(groupId, userId);
  const now = Date.now();
  const lastAttempt = state && state.attempt_started_at ? new Date(state.attempt_started_at).getTime() : 0;

  if (now - lastAttempt < COOLDOWN_MS) {
    return { onCooldown: true };
  }

  await query(
    `INSERT INTO ${P}hop_state (group_id, user_id, awaiting, prompted_at, attempt_started_at)
     VALUES (?, ?, TRUE, NOW(), NOW())
     ON DUPLICATE KEY UPDATE awaiting = TRUE, prompted_at = NOW(), attempt_started_at = NOW()`,
    [groupId, userId]
  );
  return { onCooldown: false };
}

/**
 * اگر این کاربر منتظر پاسخ "هاپ هاپ" باشد، پیام فعلی را بررسی می‌کند و وضعیت را می‌بندد.
 * برمی‌گرداند: { consumed: false } یا { consumed: true, success: boolean }
 */
async function consumeIfAwaiting(groupId, userId, text) {
  const state = await getState(groupId, userId);
  if (!state || !state.awaiting) return { consumed: false };

  await query(`UPDATE ${P}hop_state SET awaiting = FALSE WHERE group_id = ? AND user_id = ?`, [groupId, userId]);

  const success = HOP_ANSWER_REGEX.test((text || '').trim());
  return { consumed: true, success };
}

module.exports = { startChallenge, consumeIfAwaiting, getState };
