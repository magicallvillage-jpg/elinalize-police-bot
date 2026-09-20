// این ماژول دو کار می‌کند:
// ۱. detectAndSchedule: روی هر پیام گروه چک می‌کند که آیا نسخه فورواردشده خودکار یک پست
//    از کانال تنظیم‌شده (config.channelCommentary.channelId) است؛ اگر بود، در صف ثبت می‌شود.
// ۲. processDuePosts: توسط یک کرون‌جاب صدا زده می‌شود، پست‌های سررسیدشده را پردازش می‌کند:
//    ابتدا با یک ترفند بی‌ضرر (ویرایش دکمه‌های پیام کانال) چک می‌کند پست هنوز در کانال هست یا حذف شده،
//    و در صورت وجود، با هوش مصنوعی کامنت می‌سازد و روی نسخه گروه ریپلای می‌زند.
//
// تغییرات این نسخه:
//  - اگر فوروارد خودکار از کانالی با آیدی متفاوت بیاید (CHANNEL_ID اشتباه)، یک هشدار در لاگ چاپ می‌شود.
//  - فقط خطاهای «پیام پیدا نشد» به معنی حذف‌شدن پست حساب می‌شوند (قبلاً خطای «message can't be edited» هم
//    به‌اشتباه یعنی حذف‌شده بود و کامنت هیچ‌وقت ارسال نمی‌شد).
//  - اگر هوش مصنوعی موقتاً جواب نداد (مثلاً سقف درخواست مدل رایگان)، تا ۳ بار با فاصله‌ی ۶۰ ثانیه دوباره تلاش می‌شود.
//  - جلوگیری از اجرای هم‌زمان دو دور پردازش (که باعث کامنت دوبل می‌شد).
const config = require('../config');
const channelCommentaryService = require('../services/channelCommentaryService');
const aiClient = require('../services/aiClient');

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_SEC = 60;

const attempts = new Map(); // postId -> تعداد تلاش‌های ناموفق
const warnedForeignChannels = new Set();
let processing = false;

/** تشخیص و ثبت در صف - از یک میان‌افزار روی هر پیام گروه صدا زده می‌شود */
async function detectAndSchedule(ctx) {
  if (!config.channelCommentary.enabled || !config.channelCommentary.channelId) return;
  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return;

  const msg = ctx.message;
  if (!msg || !msg.sender_chat) return;
  if (!msg.is_automatic_forward) return;

  if (Number(msg.sender_chat.id) !== Number(config.channelCommentary.channelId)) {
    const foreignId = Number(msg.sender_chat.id);
    if (!warnedForeignChannels.has(foreignId)) {
      warnedForeignChannels.add(foreignId);
      console.warn(
        `[channelCommentary] ⚠️ یک فوروارد خودکار از کانالی با آیدی ${foreignId} دیده شد، ولی CHANNEL_ID شما ${config.channelCommentary.channelId} است. ` +
          'اگر این همان کانال شماست، CHANNEL_ID را در .env اصلاح کنید.'
      );
    }
    return;
  }

  // پشتیبانی از هر دو ساختار قدیمی (forward_from_message_id) و جدید (forward_origin) بات‌ای‌پی تلگرام
  const originalMessageId =
    msg.forward_from_message_id || (msg.forward_origin && msg.forward_origin.message_id) || null;
  if (!originalMessageId) {
    console.warn('[channelCommentary] فوروارد خودکار دیده شد ولی شناسه‌ی پیام اصلی کانال داخلش نبود.');
    return;
  }

  const postText = msg.text || msg.caption || '';

  try {
    const isNew = await channelCommentaryService.schedulePost(
      config.channelCommentary.channelId,
      originalMessageId,
      ctx.chat.id,
      msg.message_id,
      postText
    );
    if (isNew) {
      console.log(
        `[channelCommentary] پست ${originalMessageId} کانال در صف ثبت شد (کامنت بعد از ${Math.round(
          config.channelCommentary.delayMs / 1000
        )} ثانیه).`
      );
    }
  } catch (err) {
    console.error('[channelCommentary] خطا در ثبت صف:', err.message);
  }
}

/**
 * بررسی می‌کند پیام هنوز در کانال هست یا حذف شده، بدون تغییر محسوسی در خود پیام.
 * ترفند: تلاش برای ویرایش دکمه‌های پیام (با همون مقدار خالی قبلی)؛
 *  - "message is not modified"  → پیام هست.
 *  - "message to edit not found" / MESSAGE_ID_INVALID → پیام حذف شده.
 *  - هر خطای دیگری (مثلاً نبود دسترسی ویرایش در کانال) → نامشخص؛ فرض می‌کنیم پیام هست تا کامنت گم نشود.
 */
async function messageExistsInChannel(telegram, channelId, messageId) {
  try {
    await telegram.editMessageReplyMarkup(channelId, messageId, undefined, { inline_keyboard: [] });
    return true;
  } catch (err) {
    const desc = String(err.description || err.message || '').toLowerCase();
    if (desc.includes('not modified')) return true;
    if (
      desc.includes('message to edit not found') ||
      desc.includes('message_id_invalid') ||
      desc.includes('message not found')
    ) {
      return false;
    }
    console.warn(`[channelCommentary] بررسی وجود پست نامشخص بود (فرض بر وجود پست): ${desc}`);
    return true;
  }
}

/** پردازش یک ردیف سررسیدشده از صف */
async function processOne(telegram, post) {
  try {
    const stillExists = await messageExistsInChannel(telegram, post.channel_id, post.channel_message_id);
    if (!stillExists) {
      attempts.delete(post.id);
      await channelCommentaryService.markStatus(post.id, 'skipped_deleted');
      console.log(`[channelCommentary] پست ${post.channel_message_id} از کانال حذف شده بود؛ کامنت گذاشته نشد.`);
      return;
    }

    const comment = await aiClient.generateChannelComment(post.post_text);
    if (!comment) {
      const tries = (attempts.get(post.id) || 0) + 1;
      if (tries >= MAX_ATTEMPTS) {
        attempts.delete(post.id);
        await channelCommentaryService.markStatus(post.id, 'error');
        console.error(`[channelCommentary] پست ${post.channel_message_id}: بعد از ${tries} تلاش کامنت ساخته نشد.`);
      } else {
        attempts.set(post.id, tries);
        await channelCommentaryService.postpone(post.id, RETRY_DELAY_SEC);
        console.warn(`[channelCommentary] پست ${post.channel_message_id}: تلاش ${tries} ناموفق بود، ${RETRY_DELAY_SEC} ثانیه بعد دوباره.`);
      }
      return;
    }

    await telegram.sendMessage(post.group_id, comment, {
      reply_parameters: { message_id: post.group_message_id },
    });
    attempts.delete(post.id);
    await channelCommentaryService.markStatus(post.id, 'commented');
    console.log(`[channelCommentary] ✅ کامنت روی پست ${post.channel_message_id} ارسال شد.`);
  } catch (err) {
    console.error('[channelCommentary] خطا در پردازش پست:', err.message);
    attempts.delete(post.id);
    await channelCommentaryService.markStatus(post.id, 'error').catch(() => {});
  }
}

/** پردازش تمام پست‌های سررسیدشده - توسط کرون‌جاب index.js صدا زده می‌شود */
async function processDuePosts(telegram) {
  if (!config.channelCommentary.enabled) return;
  if (processing) return; // دور قبلی هنوز تمام نشده؛ جلوگیری از کامنت دوبل
  processing = true;
  try {
    const due = await channelCommentaryService.getDuePosts();
    for (const post of due) {
      // یکی‌یکی پردازش می‌شود تا فشار زیادی روی API هوش مصنوعی یا تلگرام وارد نشود
      // eslint-disable-next-line no-await-in-loop
      await processOne(telegram, post);
    }
  } finally {
    processing = false;
  }
}

module.exports = { detectAndSchedule, processDuePosts, messageExistsInChannel };
