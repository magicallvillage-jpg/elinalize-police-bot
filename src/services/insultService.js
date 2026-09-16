// سرویس دستور "لیزه توهین" (شوخی گروهی):
// یک لیست پیش‌فرض داخل src/data/messages.json (userCommands.insults.defaults) وجود دارد،
// و ادمین مادر می‌تواند مورد اضافه/حذف کند که در جدول elinalize_insults ذخیره می‌شود.
// لیست نهایی = پیش‌فرض‌های messages.json + موارد اضافه‌شده در دیتابیس برای همان گروه.
const { query } = require('../database/db');
const config = require('../config');
const { allMessages } = require('../utils/messages');
const { pickRandom } = require('../utils/helpers');

const P = config.tablePrefix;

function getDefaults() {
  return (allMessages.userCommands && allMessages.userCommands.insults && allMessages.userCommands.insults.defaults) || [];
}

async function getCustomInsults(groupId) {
  return query(`SELECT * FROM ${P}insults WHERE group_id = ? ORDER BY created_at DESC`, [groupId]);
}

async function getAllInsults(groupId) {
  const custom = await getCustomInsults(groupId);
  return [...getDefaults(), ...custom.map((r) => r.text)];
}

async function getRandomInsult(groupId) {
  const all = await getAllInsults(groupId);
  if (!all.length) return null;
  return pickRandom(all);
}

async function addInsult(groupId, text, createdBy) {
  await query(`INSERT IGNORE INTO ${P}insults (group_id, text, created_by) VALUES (?, ?, ?)`, [
    groupId,
    text,
    createdBy,
  ]);
}

/** حذف یک توهین سفارشی (روی پیش‌فرض‌های messages.json تاثیری ندارد - آن‌ها باید مستقیماً در فایل ویرایش شوند) */
async function removeInsult(groupId, text) {
  const result = await query(`DELETE FROM ${P}insults WHERE group_id = ? AND text = ?`, [groupId, text]);
  return result.affectedRows > 0;
}

module.exports = { getDefaults, getCustomInsults, getAllInsults, getRandomInsult, addInsult, removeInsult };
