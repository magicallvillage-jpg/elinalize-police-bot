// این ماژول دو کار می‌کند:
// ۱. detectAndSchedule: روی هر پیام گروه چک می‌کند که آیا نسخه فورواردشده خودکار یک پست
//    از کانال تنظیم‌شده (config.channelCommentary.channelId) است؛ اگر بود، در صف ثبت می‌شود.
// ۲. processDuePosts: توسط یک کرون‌جاب صدا زده می‌شود، پست‌های سررسیدشده را پردازش می‌کند:
//    ابتدا با یک ترفند بی‌ضرر (ویرایش دکمه‌های پیام کانال) چک می‌کند پست هنوز در کانال هست یا حذف شده،
//    و در صورت وجود، با هوش مصنوعی کامنت می‌سازد و روی نسخه گروه ریپلای می‌زند.
const config = require('../config');
const channelCommentaryService = require('../services/channelCommentaryService');
const aiClient = require('../services/aiClient');

/** تشخیص و ثبت در صف - از یک میان‌افزار روی هر پیام گروه صدا زده می‌شود */
async function detectAndSchedule(ctx) {
  if (!config.channelCommentary.enabled || !config.channelCommentary.channelId) return;
  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return;

  const msg = ctx.message;
  if (!msg || !msg.sender_chat) return;
  if (Number(msg.sender_chat.id) !== Number(config.channelCommentary.channelId)) return;
  if (!msg.is_automatic_forward) return;

  // پشتیبانی از هر دو ساختار قدیمی (forward_from_message_id) و جدید (forward_origin) بات‌ای‌پی تلگرام
  const originalMessageId =
    msg.forward_from_message_id || (msg.forward_origin && msg.forward_origin.message_id) || null;
  if (!originalMessageId) return;

  const postText = msg.text || msg.caption || '';

  try {
    await channelCommentaryService.schedulePost(
      config.channelCommentary.channelId,
      originalMessageId,
      ctx.chat.id,
      msg.message_id,
      postText
    );
  } catch (err) {
    console.error('[channelCommentary] خطا در ثبت صف:', err.message);
  }
}

/**
 * بررسی می‌کند پیام هنوز در کانال هست یا حذف شده، بدون تغییر محسوسی در خود پیام.
 * از این تکنیک استفاده می‌شود: تلاش برای ویرایش دکمه‌های پیام (با همون مقدار خالی قبلی)؛
 * اگر پیام حذف شده باشد تلگرام خطای "message to edit not found" می‌دهد،
 * و اگر پیام باشد ولی چیزی عوض نشده باشد خطای "message is not modified" می‌دهد که یعنی پیام هست.
 */
async function messageExistsInChannel(telegram, channelId, messageId) {
  try {
    await telegram.editMessageReplyMarkup(channelId, messageId, undefined, { inline_keyboard: [] });
    return true;
  } catch (err) {
    const desc = String(err.description || err.message || '').toLowerCase();
    if (desc.includes('not modified')) return true;
    if (desc.includes('not found') || desc.includes('message_id_invalid') || desc.includes('message can')) {
      return false;
    }
    console.error('[channelCommentary] خطای نامشخص هنگام بررسی وجود پست، فرض بر وجود پیام گذاشته شد:', err.message);
    return true;
  }
}

/** پردازش یک ردیف سررسیدشده از صف */
async function processOne(telegram, post) {
  try {
    const stillExists = await messageExistsInChannel(telegram, post.channel_id, post.channel_message_id);
    if (!stillExists) {
      await channelCommentaryService.markStatus(post.id, 'skipped_deleted');
      return;
    }

    const comment = await aiClient.generateChannelComment(post.post_text);
    if (!comment) {
      await channelCommentaryService.markStatus(post.id, 'error');
      return;
    }

    await telegram.sendMessage(post.group_id, comment, {
      reply_parameters: { message_id: post.group_message_id },
    });
    await channelCommentaryService.markStatus(post.id, 'commented');
  } catch (err) {
    console.error('[channelCommentary] خطا در پردازش پست:', err.message);
    await channelCommentaryService.markStatus(post.id, 'error').catch(() => {});
  }
}

/** پردازش تمام پست‌های سررسیدشده - توسط کرون‌جاب index.js صدا زده می‌شود */
async function processDuePosts(telegram) {
  if (!config.channelCommentary.enabled) return;
  const due = await channelCommentaryService.getDuePosts();
  for (const post of due) {
    // یکی‌یکی پردازش می‌شود تا فشار زیادی روی API هوش مصنوعی یا تلگرام وارد نشود
    // eslint-disable-next-line no-await-in-loop
    await processOne(telegram, post);
  }
}

module.exports = { detectAndSchedule, processDuePosts, messageExistsInChannel };
