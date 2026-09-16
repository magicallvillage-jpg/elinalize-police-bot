// سرویس لاگ فعالیت: هر عملیات مهم مقام‌دارها و کاربران اینجا ثبت می‌شود
// تا دستورات "گزارش فعالیت"، "لیست مجرمین" و "چه خبر" بتوانند از آن بخوانند.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

async function logActivity({ groupId, actorUserId, rankId = null, action, targetUserId = null, details = null }) {
  await query(
    `INSERT INTO ${P}activity_log (group_id, actor_user_id, rank_id, action, target_user_id, details)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [groupId, actorUserId, rankId, action, targetUserId, details]
  );
}

/** آخرین فعالیت‌های یک کاربر خاص (برای "گزارش فعالیت") */
async function getUserActivity(groupId, targetUserId, limit = 15) {
  return query(
    `SELECT * FROM ${P}activity_log WHERE group_id = ? AND target_user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [groupId, targetUserId, limit]
  );
}

/** فعالیت مقام‌ها در N ساعت اخیر، گروه‌بندی‌شده بر اساس فرد (برای "چه خبر") */
async function getRecentRankActivity(groupId, hours = 24) {
  return query(
    `SELECT actor_user_id, COUNT(*) as action_count, MAX(created_at) as last_action
     FROM ${P}activity_log
     WHERE group_id = ? AND rank_id IS NOT NULL AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
     GROUP BY actor_user_id
     ORDER BY action_count DESC`,
    [groupId, hours]
  );
}

module.exports = { logActivity, getUserActivity, getRecentRankActivity };
