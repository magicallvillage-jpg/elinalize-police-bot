// سرویس مدیریت صف پست‌های کانال: وقتی نسخه فوروارد خودکار یک پست کانال در گروه بحث دیده می‌شود،
// یک ردیف با due_at (زمان سررسید = الان + تاخیر تنظیم‌شده) ثبت می‌شود. یک کرون‌جاب در index.js
// هر چند ثانیه ردیف‌های سررسیدشده را پردازش می‌کند: وجود پست در کانال را چک می‌کند،
// و در صورت وجود، کامنت هوش مصنوعی می‌سازد و به‌عنوان ریپلای روی نسخه گروه می‌فرستد.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

/** ثبت یک پست جدید در صف (اگر قبلاً ثبت نشده باشد) */
async function schedulePost(channelId, channelMessageId, groupId, groupMessageId, postText) {
  const dueAt = new Date(Date.now() + config.channelCommentary.delayMs);
  await query(
    `INSERT IGNORE INTO ${P}pending_channel_posts
       (channel_id, channel_message_id, group_id, group_message_id, post_text, due_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [channelId, channelMessageId, groupId, groupMessageId, postText || null, dueAt]
  );
}

/** پست‌هایی که زمانشان رسیده و هنوز پردازش نشده‌اند */
async function getDuePosts(limit = 20) {
  return query(`SELECT * FROM ${P}pending_channel_posts WHERE status = 'pending' AND due_at <= NOW() LIMIT ?`, [
    limit,
  ]);
}

async function markStatus(id, status) {
  await query(`UPDATE ${P}pending_channel_posts SET status = ? WHERE id = ?`, [status, id]);
}

module.exports = { schedulePost, getDuePosts, markStatus };
