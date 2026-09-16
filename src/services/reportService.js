// سرویس گزارش: وقتی یک کاربر عادی دستور "لیزه اخطار" می‌دهد، یک رکورد pending ساخته می‌شود
// و مقام‌دارها با زدن دکمه شیشه‌ای می‌توانند تایید/رد کنند. تاییدشده‌ها وارد "لیست مجرمین" می‌شوند.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

async function createReport(groupId, reporterId, targetId) {
  const result = await query(
    `INSERT INTO ${P}reports (group_id, reporter_id, target_id, status) VALUES (?, ?, ?, 'pending')`,
    [groupId, reporterId, targetId]
  );
  return result.insertId;
}

async function getReport(reportId) {
  const rows = await query(`SELECT * FROM ${P}reports WHERE id = ? LIMIT 1`, [reportId]);
  return rows[0] || null;
}

async function resolveReport(reportId, status, resolvedBy) {
  await query(`UPDATE ${P}reports SET status = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?`, [
    status,
    resolvedBy,
    reportId,
  ]);
}

/** لیست گزارش‌های تاییدشده (لیست مجرمین)، جدیدترین اول، با صفحه‌بندی */
async function listApprovedReports(groupId, offset = 0, limit = 10) {
  return query(
    `SELECT * FROM ${P}reports WHERE group_id = ? AND status = 'approved' ORDER BY resolved_at DESC LIMIT ? OFFSET ?`,
    [groupId, limit, offset]
  );
}

async function countApprovedReports(groupId) {
  const rows = await query(`SELECT COUNT(*) as c FROM ${P}reports WHERE group_id = ? AND status = 'approved'`, [
    groupId,
  ]);
  return rows[0].c;
}

module.exports = { createReport, getReport, resolveReport, listApprovedReports, countApprovedReports };
