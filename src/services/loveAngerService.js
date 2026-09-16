// سیستم علاقه‌مندی/عصبانیت الینالیزه نسبت به هر کاربر:
// - علاقه با ابراز محبت کاربر (حداکثر هر ۱ ساعت یک‌بار) ۵٪ اضافه می‌شود.
// - عصبانیت فقط با گذشت زمان کم می‌شود (۵٪ در روز - از طریق cron در index.js).
// - تایید گزارش یک کاربر، عصبانیت را ۱۰٪ زیاد می‌کند.
// - اخراج کاربر توسط مقام‌ها: علاقه ۲۰٪ کم و عصبانیت ۴۰٪ زیاد می‌شود.
// - وقتی علاقه ۱۰۰٪ و عصبانیت ۰٪ شود، مقام موقت «عزیز الینالیزه» اعطا و در گروه تبریک گفته می‌شود،
//   سپس ۵۰٪ از علاقه کم می‌شود تا چرخه دوباره شروع شود.
const { query } = require('../database/db');
const config = require('../config');
const { clamp } = require('../utils/helpers');

const P = config.tablePrefix;
const cfg = config.loveAnger;

async function getState(groupId, userId) {
  const rows = await query(`SELECT * FROM ${P}love_anger WHERE group_id = ? AND user_id = ? LIMIT 1`, [
    groupId,
    userId,
  ]);
  if (rows[0]) return rows[0];
  return { group_id: groupId, user_id: userId, love: 0, anger: 0, last_love_at: null };
}

async function ensureRow(groupId, userId) {
  await query(`INSERT IGNORE INTO ${P}love_anger (group_id, user_id, love, anger) VALUES (?, ?, 0, 0)`, [
    groupId,
    userId,
  ]);
}

async function setState(groupId, userId, love, anger, lastLoveAt) {
  await ensureRow(groupId, userId);
  await query(
    `UPDATE ${P}love_anger SET love = ?, anger = ?${lastLoveAt !== undefined ? ', last_love_at = ?' : ''} WHERE group_id = ? AND user_id = ?`,
    lastLoveAt !== undefined
      ? [clamp(love, 0, 100), clamp(anger, 0, 100), lastLoveAt, groupId, userId]
      : [clamp(love, 0, 100), clamp(anger, 0, 100), groupId, userId]
  );
}

/**
 * ثبت یک ابراز علاقه از طرف کاربر.
 * برمی‌گرداند: { onCooldown, love, anger, grantedSpecialRank }
 */
async function registerLoveAction(groupId, userId) {
  const state = await getState(groupId, userId);
  const now = Date.now();
  const lastLoveTime = state.last_love_at ? new Date(state.last_love_at).getTime() : 0;

  if (now - lastLoveTime < cfg.loveCooldownMs) {
    return { onCooldown: true, love: state.love, anger: state.anger, grantedSpecialRank: false };
  }

  const newLove = clamp(state.love + cfg.loveIncreasePerAction, 0, 100);
  await setState(groupId, userId, newLove, state.anger, new Date());

  const grantedSpecialRank = newLove >= 100 && state.anger <= 0;
  return { onCooldown: false, love: newLove, anger: state.anger, grantedSpecialRank };
}

/** افزایش عصبانیت بابت تایید گزارش کاربر */
async function applyReportApprovedEffect(groupId, userId) {
  const state = await getState(groupId, userId);
  const newAnger = clamp(state.anger + cfg.angerIncreaseOnReport, 0, 100);
  await setState(groupId, userId, state.love, newAnger);
  return { love: state.love, anger: newAnger };
}

/** اثر اخراج کاربر توسط مقام‌ها روی علاقه/عصبانیت */
async function applyKickEffect(groupId, userId) {
  const state = await getState(groupId, userId);
  const newLove = clamp(state.love - cfg.kickLoveDecrease, 0, 100);
  const newAnger = clamp(state.anger + cfg.kickAngerIncrease, 0, 100);
  await setState(groupId, userId, newLove, newAnger);
  return { love: newLove, anger: newAnger };
}

/** کاهش علاقه بعد از اعطای مقام موقت "عزیز الینالیزه" */
async function applySpecialRankGrantedEffect(groupId, userId) {
  const state = await getState(groupId, userId);
  const newLove = clamp(state.love - cfg.specialRankLoveDecreaseAfter, 0, 100);
  await setState(groupId, userId, newLove, state.anger);
  return { love: newLove, anger: state.anger };
}

/** موفقیت در چالش "هاپ هاپ" بعد از "لیزه سگتم": ۵٪ افزایش علاقه (مستقل از کول‌داون دوست‌دارم) */
async function applyHopSuccessEffect(groupId, userId) {
  const state = await getState(groupId, userId);
  const newLove = clamp(state.love + 5, 0, 100);
  await setState(groupId, userId, newLove, state.anger);
  return { love: newLove, anger: state.anger };
}

/** شکست در چالش "هاپ هاپ": ۱۰٪ کاهش علاقه */
async function applyHopFailureEffect(groupId, userId) {
  const state = await getState(groupId, userId);
  const newLove = clamp(state.love - 10, 0, 100);
  await setState(groupId, userId, newLove, state.anger);
  return { love: newLove, anger: state.anger };
}

/** کاهش روزانه عصبانیت همه کاربران - توسط cron یک‌بار در روز صدا زده می‌شود */
async function applyDailyAngerDecay() {
  await query(`UPDATE ${P}love_anger SET anger = GREATEST(anger - ?, 0)`, [cfg.angerDailyDecay]);
}

module.exports = {
  getState,
  registerLoveAction,
  applyReportApprovedEffect,
  applyKickEffect,
  applySpecialRankGrantedEffect,
  applyHopSuccessEffect,
  applyHopFailureEffect,
  applyDailyAngerDecay,
};
