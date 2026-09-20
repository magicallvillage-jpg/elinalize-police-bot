// سرویس مدیریت صف پست‌های کانال: وقتی نسخه فوروارد خودکار یک پست کانال در گروه بحث دیده می‌شود،
// یک ردیف با due_at (زمان سررسید = الان + تاخیر تنظیم‌شده) ثبت می‌شود. یک کرون‌جاب در index.js
// هر چند ثانیه ردیف‌های سررسیدشده را پردازش می‌کند: وجود پست در کانال را چک می‌کند،
// و در صورت وجود، کامنت هوش مصنوعی می‌سازد و به‌عنوان ریپلای روی نسخه گروه می‌فرستد.
//
// رفع باگ: قبلاً due_at با ساعت Node ساخته می‌شد ولی با NOW() خود MySQL مقایسه می‌شد. اگر منطقه‌ی زمانی
// سرور Node با MySQL فرق داشت، کامنت‌ها چند ساعت دیر (یا فوراً) پردازش می‌شدند. الان زمان سررسید
// را خود MySQL حساب می‌کند (NOW() + N ثانیه) و دیگر به منطقه‌ی زمانی وابسته نیست.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

/** ثبت یک پست جدید در صف. برمی‌گرداند true اگر جدید بود و false اگر قبلاً ثبت شده بود. */
async function schedulePost(channelId, channelMessageId, groupId, groupMessageId, postText) {
  const delaySec = Math.max(0, Math.round(Number(config.channelCommentary.delayMs) / 1000) || 0);
  const result = await query(
    `INSERT IGNORE INTO ${P}pending_channel_posts
       (channel_id, channel_message_id, group_id, group_message_id, post_text, due_at, status)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), 'pending')`,
    [channelId, channelMessageId, groupId, groupMessageId, postText || null, delaySec]
  );
  return result.affectedRows > 0;
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

/** عقب انداختن یک پست به‌اندازه‌ی چند ثانیه (برای تلاش مجدد بعد از خطای موقت هوش مصنوعی) */
async function postpone(id, seconds) {
  await query(`UPDATE ${P}pending_channel_posts SET due_at = DATE_ADD(NOW(), INTERVAL ? SECOND) WHERE id = ?`, [
    Math.max(1, Math.round(seconds)),
    id,
  ]);
}

module.exports = { schedulePost, getDuePosts, markStatus, postpone };
