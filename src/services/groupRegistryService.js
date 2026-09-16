// این جدول کوچک فقط لیست گروه‌هایی که ربات داخلشونه رو نگه می‌داره،
// تا وقتی ادمین مادر در پیوی دستور "پنل" رو می‌زنه بتونیم گروه‌هاشو نشون بدیم.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}known_groups (
      group_id BIGINT PRIMARY KEY,
      title VARCHAR(255) DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function registerGroup(groupId, title) {
  await query(
    `INSERT INTO ${P}known_groups (group_id, title) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE title = VALUES(title)`,
    [groupId, title || null]
  );
}

/** گروه‌هایی که یک کاربر خاص در آن‌ها ادمین مادر یا دارای دسترسی پنل است را پیدا می‌کند */
async function listGroupsForPanelAccess(userId, isMotherAdmin) {
  const groups = await query(`SELECT * FROM ${P}known_groups`);
  if (isMotherAdmin) return groups;

  const roleService = require('./roleService');
  const allowed = [];
  for (const g of groups) {
    const rank = await roleService.getUserRank(g.group_id, userId);
    if (rank && rank.permissions.panelAccess) allowed.push(g);
  }
  return allowed;
}

module.exports = { ensureTable, registerGroup, listGroupsForPanelAccess };
