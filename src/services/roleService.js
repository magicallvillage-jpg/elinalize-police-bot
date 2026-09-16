// سرویس مقام‌ها: ساخت مقام توسط ادمین مادر، تخصیص مقام به کاربران،
// بررسی سطح دسترسی هر مقام و مقایسه سلسله‌مراتبی (priority) بین مقام‌ها.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

// لیست کامل کلیدهای دسترسی که هر مقام می‌تواند داشته باشد
const PERMISSION_KEYS = [
  'kick', // اخراج
  'unkick', // حذف اخراج
  'warn', // اخطار
  'removeWarn', // حذف اخطار
  'deleteMessage', // حذف پیام
  'spoiler', // اسپویلر
  'mute', // سکوت
  'showActivity', // گزارش فعالیت کاربر
  'showRank', // نمایش مقام
  'banList', // لیست زندانی
  'criminalList', // لیست مجرمین
  'recentActivity', // چه خبر
  'setRank', // تعیین/تغییر مقام دیگران (فقط ادمین مادر به‌صورت پیش‌فرض)
  'panelAccess', // دسترسی به پنل مدیریت در گروه/پی‌وی
];

function isMotherAdmin(userId) {
  return config.motherAdminIds.includes(Number(userId));
}

/** ساخت مقام جدید در یک گروه - فقط ادمین مادر مجاز است (بررسی در سطح handler انجام می‌شود) */
async function createRank(groupId, name, priority, permissions, createdBy) {
  const perms = normalizePermissions(permissions);
  await query(
    `INSERT INTO ${P}ranks (group_id, name, priority, permissions, created_by) VALUES (?, ?, ?, ?, ?)`,
    [groupId, name, priority, JSON.stringify(perms), createdBy]
  );
  return getRankByName(groupId, name);
}

/** به‌روزرسانی سطح دسترسی یک مقام - فقط ادمین مادر */
async function updateRankPermissions(groupId, rankId, permissions) {
  const perms = normalizePermissions(permissions);
  await query(`UPDATE ${P}ranks SET permissions = ? WHERE id = ? AND group_id = ?`, [
    JSON.stringify(perms),
    rankId,
    groupId,
  ]);
}

/** به‌روزرسانی سطح (priority) یک مقام برای تعیین سلسله‌مراتب */
async function updateRankPriority(groupId, rankId, priority) {
  await query(`UPDATE ${P}ranks SET priority = ? WHERE id = ? AND group_id = ?`, [priority, rankId, groupId]);
}

function normalizePermissions(input = {}) {
  const perms = {};
  for (const key of PERMISSION_KEYS) {
    perms[key] = Boolean(input[key]);
  }
  return perms;
}

async function getRankByName(groupId, name) {
  const rows = await query(`SELECT * FROM ${P}ranks WHERE group_id = ? AND name = ? LIMIT 1`, [groupId, name]);
  return rows[0] ? deserializeRank(rows[0]) : null;
}

async function getRankById(rankId) {
  const rows = await query(`SELECT * FROM ${P}ranks WHERE id = ? LIMIT 1`, [rankId]);
  return rows[0] ? deserializeRank(rows[0]) : null;
}

async function listRanks(groupId) {
  const rows = await query(`SELECT * FROM ${P}ranks WHERE group_id = ? ORDER BY priority DESC`, [groupId]);
  return rows.map(deserializeRank);
}

function deserializeRank(row) {
  return {
    ...row,
    permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
  };
}

/**
 * تخصیص مقام به یک کاربر در گروه. اگر expiresAt داده نشود، مقام دائمی است.
 * قبل از فراخوانی این تابع باید سلسله‌مراتب (assignerCanAssign) بررسی شده باشد.
 */
async function assignRank(groupId, userId, rankId, grantedBy, expiresAt = null) {
  // هر کاربر در هر گروه فقط یک مقام غیرموقت دارد؛ مقام قبلی غیرموقت حذف می‌شود
  await query(`DELETE FROM ${P}user_ranks WHERE group_id = ? AND user_id = ? AND expires_at IS NULL`, [
    groupId,
    userId,
  ]);
  await query(
    `INSERT INTO ${P}user_ranks (group_id, user_id, rank_id, granted_by, expires_at) VALUES (?, ?, ?, ?, ?)`,
    [groupId, userId, rankId, grantedBy, expiresAt]
  );
}

async function removeRank(groupId, userId) {
  await query(`DELETE FROM ${P}user_ranks WHERE group_id = ? AND user_id = ?`, [groupId, userId]);
}

/** گرفتن بالاترین مقام فعال یک کاربر در گروه (با در نظر گرفتن انقضا) */
async function getUserRank(groupId, userId) {
  if (isMotherAdmin(userId)) {
    return {
      id: null,
      name: 'ادمین مادر',
      priority: Number.MAX_SAFE_INTEGER,
      permissions: normalizePermissions(
        PERMISSION_KEYS.reduce((acc, k) => ({ ...acc, [k]: true }), {})
      ),
      isMother: true,
    };
  }

  const rows = await query(
    `SELECT ur.*, r.name, r.priority, r.permissions
     FROM ${P}user_ranks ur
     JOIN ${P}ranks r ON r.id = ur.rank_id
     WHERE ur.group_id = ? AND ur.user_id = ?
       AND (ur.expires_at IS NULL OR ur.expires_at > NOW())
     ORDER BY r.priority DESC
     LIMIT 1`,
    [groupId, userId]
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: row.rank_id,
    name: row.name,
    priority: row.priority,
    permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions,
    expiresAt: row.expires_at,
    isMother: false,
  };
}

/** آیا کاربر یک دسترسی خاص را دارد (ادمین مادر همیشه true) */
async function hasPermission(groupId, userId, permissionKey) {
  const rank = await getUserRank(groupId, userId);
  if (!rank) return false;
  if (rank.isMother) return true;
  return Boolean(rank.permissions[permissionKey]);
}

/**
 * بررسی سلسله‌مراتب: آیا actorRank اجازه دارد روی کاربری با targetRank عملیات انجام دهد؟
 * قانون: مقام پایین‌رتبه نمی‌تواند روی مقام هم‌رتبه یا بالاتر عمل کند.
 * ادمین مادر همیشه مجاز است.
 */
function canActOnTarget(actorRank, targetRank) {
  if (actorRank && actorRank.isMother) return true;
  const actorPriority = actorRank ? actorRank.priority : 0;
  const targetPriority = targetRank ? targetRank.priority : 0;
  return actorPriority > targetPriority;
}

module.exports = {
  PERMISSION_KEYS,
  isMotherAdmin,
  createRank,
  updateRankPermissions,
  updateRankPriority,
  getRankByName,
  getRankById,
  listRanks,
  assignRank,
  removeRank,
  getUserRank,
  hasPermission,
  canActOnTarget,
};
