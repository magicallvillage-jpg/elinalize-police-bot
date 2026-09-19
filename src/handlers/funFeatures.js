// این ماژول دو قابلیت سرگرمی را پیاده می‌کند:
// - ارسال یک استیکر تصادفی (یا مجموعه‌ای از استیکرهای چندبخشی) بعد از N پیام در گروه.
// - شوخی "پام پلیس": بعد از N پیام، به آخرین کسی که پیام داده ریپلای می‌زند و یک دکمه
//   "لیس زدن" می‌گذارد که فقط خود آن شخص می‌تواند بزند و ۵٪ علاقه بگیرد.
//
// شمارنده هر گروه در حافظه (RAM) نگهداری می‌شود، چون این فقط برای یک بازی/شوخی زودگذر
// است و از دست رفتنش با ری‌استارت ربات مشکلی ایجاد نمی‌کند.
const config = require('../config');
const mediaService = require('../services/mediaService');
const loveAngerService = require('../services/loveAngerService');
const { t } = require('../utils/messages');
const { mentionUser, pickRandom } = require('../utils/helpers');

const counters = new Map(); // groupId -> { stickerCount, pamCount }

function getCounters(groupId) {
  if (!counters.has(groupId)) counters.set(groupId, { stickerCount: 0, pamCount: 0 });
  return counters.get(groupId);
}

/**
 * روی هر پیام معمولی گروه (غیر از پیام‌های کانال و ربات‌ها) صدا زده می‌شود.
 * شمارنده‌ها را افزایش می‌دهد و در صورت رسیدن به آستانه، قابلیت مربوطه را اجرا می‌کند.
 */
async function handleGroupActivity(ctx) {
  if (!ctx.chat || (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup')) return;
  if (!ctx.from || ctx.from.is_bot) return;
  if (ctx.message && ctx.message.sender_chat) return; // پست‌های کانال به‌حساب نمی‌آیند

  const groupId = ctx.chat.id;
  const c = getCounters(groupId);

  if (config.stickerBurst.enabled) {
    c.stickerCount += 1;
    if (c.stickerCount >= config.stickerBurst.messageThreshold) {
      c.stickerCount = 0;
      await sendStickerBurst(ctx).catch((err) => console.error('[stickerBurst] خطا:', err.message));
    }
  }

  if (config.pamPolice.enabled) {
    c.pamCount += 1;
    if (c.pamCount >= config.pamPolice.messageThreshold) {
      c.pamCount = 0;
      await triggerPamPolice(ctx, ctx.from).catch((err) => console.error('[pamPolice] خطا:', err.message));
    }
  }
}

/** ارسال یک بسته استیکر تصادفی (تکی یا چندبخشی به ترتیب) */
async function sendStickerBurst(ctx) {
  // بسته‌ها = موارد واقعی داخل stickers.json + موارد اضافه‌شده از پنل مدیریتی (دیتابیس)
  const usablePacks = await mediaService.getUsableStickerPacks();
  if (!usablePacks.length) return; // هنوز هیچ استیکری تنظیم نشده

  const pack = pickRandom(usablePacks);
  for (const fileId of pack.fileIds) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.telegram.sendSticker(ctx.chat.id, fileId);
  }
}

/** شروع شوخی "پام پلیس" روی آخرین فرستنده پیام */
async function triggerPamPolice(ctx, targetUser) {
  const caption = t('userCommands.pamPolice.caption', { target: mentionUser(targetUser) });
  const keyboard = {
    inline_keyboard: [
      [{ text: t('userCommands.pamPolice.lickButton'), callback_data: `pam_lick:${ctx.chat.id}:${targetUser.id}` }],
    ],
  };

  // عکس‌ها = موارد واقعی داخل pamPolicePhotos.json + موارد اضافه‌شده از پنل مدیریتی (دیتابیس)
  const photos = await mediaService.getUsablePhotos();

  if (photos.length) {
    try {
      await ctx.telegram.sendPhoto(ctx.chat.id, pickRandom(photos), {
        caption,
        parse_mode: 'HTML',
        reply_markup: keyboard,
      });
      return;
    } catch (err) {
      // مثلاً file_id نامعتبر: شوخی از دست نمی‌رود و به‌صورت متنی ارسال می‌شود
      console.error('[pamPolice] ارسال عکس ناموفق بود، پیام متنی فرستاده می‌شود:', err.message);
    }
  }
  await ctx.telegram.sendMessage(ctx.chat.id, caption, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

/** پردازش کلیک روی دکمه "لیس زدن" - فقط برای همان کاربر هدف مجاز است */
async function handlePamLick(ctx, groupId, targetUserId) {
  if (ctx.from.id !== targetUserId) {
    await ctx.answerCbQuery(t('userCommands.pamPolice.notYourTurn'), { show_alert: true });
    return;
  }

  await loveAngerService.applyLoveDelta(groupId, targetUserId, config.pamPolice.loveIncreaseOnLick);

  await ctx.answerCbQuery('🐾');
  await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => {});
  await ctx.telegram.sendMessage(groupId, t('userCommands.pamPolice.lickReport', { target: mentionUser(ctx.from) }), {
    parse_mode: 'HTML',
  });
}

module.exports = { handleGroupActivity, handlePamLick };
