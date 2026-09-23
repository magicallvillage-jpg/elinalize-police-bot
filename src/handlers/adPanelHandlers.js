// پنل مدیریت تبلیغات (فقط ادمین مادر، فقط در پیوی ربات).
// یک تبلیغ = متن + چند دکمه شیشه‌ای اختیاری (فقط متن + لینک؛ طبق محدودیت Bot API، رنگ دکمه
// قابل تنظیم نیست). بعد از رسیدن به «فاصله ارسال» تنظیم‌شده در هر گروه، یکی از تبلیغ‌های فعال
// به‌صورت تصادفی انتخاب و فرستاده می‌شود (منطق شمارش و ارسال در funFeatures.js است).
//
// وضعیت «در حال ساخت تبلیغ» فقط در RAM نگهداری می‌شود (مثل بقیه‌ی سشن‌های پنل).
const roleService = require('../services/roleService');
const adService = require('../services/adService');

const sessions = new Map(); // userId -> { step, content, buttons, tempButtonText }

function isPrivateMother(ctx) {
  return Boolean(ctx.chat && ctx.chat.type === 'private' && ctx.from && roleService.isMotherAdmin(ctx.from.id));
}

function endSession(userId) {
  sessions.delete(userId);
}

async function ack(ctx, text, alert = false) {
  await ctx.answerCbQuery(text, { show_alert: alert }).catch(() => {});
}

/** ویرایش پیام دکمه‌دار قبلی در جا، یا در صورت نبودنش ارسال پیام جدید */
async function showScreen(ctx, text, keyboard) {
  const extra = { reply_markup: { inline_keyboard: keyboard } };
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;
  if (msg && typeof msg.text === 'string') {
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (err) {
      const desc = String(err.description || err.message || '').toLowerCase();
      if (desc.includes('not modified')) return;
    }
  }
  await ctx.reply(text, extra);
}

// ===================== منوی اصلی تبلیغات =====================

async function showAdMenu(ctx) {
  const interval = await adService.getIntervalMessages();
  const ads = await adService.listAds();
  const enabledCount = ads.filter((a) => a.enabled).length;
  const text =
    '📢 مدیریت تبلیغات\n\n' +
    `⏱ فاصله ارسال فعلی: هر ${interval} پیام (در هر گروه)\n` +
    `📋 تعداد تبلیغ‌ها: ${ads.length} (فعال: ${enabledCount})\n\n` +
    'ℹ️ توجه: تلگرام رنگ دکمه‌های شیشه‌ای رو قابل تنظیم نمی‌کنه؛ فقط متن و لینک هر دکمه قابل تنظیمه.';
  await showScreen(ctx, text, [
    [{ text: '➕ ساخت تبلیغ جدید', callback_data: 'ad_create' }],
    [{ text: '📋 لیست تبلیغ‌ها', callback_data: 'ad_list' }],
    [{ text: `⏱ تنظیم فاصله ارسال (${interval} پیام)`, callback_data: 'ad_set_interval' }],
    [{ text: '⬅️ بازگشت', callback_data: 'media_root' }],
  ]);
}

// ===================== ساخت تبلیغ جدید =====================

function buttonMenuView(s) {
  let text = `📝 پیش‌نمایش تبلیغ:\n\n${s.content}\n\n`;
  if (s.buttons.length) {
    text += `🔘 دکمه‌های فعلی (${s.buttons.length}):\n`;
    text += s.buttons.map((b, i) => `${i + 1}. ${b.text} → ${b.url}`).join('\n');
  } else {
    text += '🔘 هنوز دکمه‌ای اضافه نشده (دکمه اختیاریه).';
  }
  const keyboard = [[{ text: '➕ افزودن دکمه', callback_data: 'ad_add_button' }]];
  if (s.buttons.length) keyboard.push([{ text: '↩️ حذف آخرین دکمه', callback_data: 'ad_undo_button' }]);
  keyboard.push([{ text: '✅ ذخیره تبلیغ', callback_data: 'ad_save' }]);
  keyboard.push([{ text: '❌ لغو', callback_data: 'ad_cancel' }]);
  return { text, keyboard };
}

async function startCreate(ctx) {
  endSession(ctx.from.id);
  sessions.set(ctx.from.id, { step: 'content', buttons: [] });
  await showScreen(ctx, '📝 متن تبلیغ رو بفرست (همون چیزی که توی گروه‌ها ارسال می‌شه):', [
    [{ text: '❌ لغو', callback_data: 'ad_cancel' }],
  ]);
}

/**
 * پیام متنی ادمین مادر در پیوی. برمی‌گرداند true اگر این پیام مربوط به ساخت/تنظیم تبلیغ بود و مصرف شد.
 */
async function handleIncomingText(ctx, text) {
  if (!isPrivateMother(ctx)) return false;
  const s = sessions.get(ctx.from.id);
  if (!s) return false;

  const trimmed = String(text || '').trim();
  if (!trimmed) return true;

  if (s.step === 'content') {
    s.content = trimmed;
    s.step = 'buttons';
    const { text: t2, keyboard } = buttonMenuView(s);
    await ctx.reply(t2, { reply_markup: { inline_keyboard: keyboard } });
    return true;
  }

  if (s.step === 'buttons') {
    await ctx.reply('از دکمه‌های پایین پیام استفاده کن؛ اگه می‌خوای دکمه اضافه کنی «➕ افزودن دکمه» رو بزن.');
    return true;
  }

  if (s.step === 'button_text') {
    s.tempButtonText = trimmed;
    s.step = 'button_url';
    await ctx.reply('حالا لینک این دکمه رو بفرست (باید با http:// یا https:// شروع بشه):');
    return true;
  }

  if (s.step === 'button_url') {
    if (!/^https?:\/\//i.test(trimmed)) {
      await ctx.reply('❌ لینک معتبر نیست. باید با http:// یا https:// شروع بشه، دوباره بفرست:');
      return true;
    }
    s.buttons.push({ text: s.tempButtonText, url: trimmed });
    delete s.tempButtonText;
    s.step = 'buttons';
    const { text: t2, keyboard } = buttonMenuView(s);
    await ctx.reply(t2, { reply_markup: { inline_keyboard: keyboard } });
    return true;
  }

  if (s.step === 'interval') {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n <= 0) {
      await ctx.reply('یک عدد صحیح و مثبت بفرست، مثلاً 100');
      return true;
    }
    await adService.setIntervalMessages(Math.round(n));
    endSession(ctx.from.id);
    await ctx.reply(`✅ فاصله ارسال تبلیغ روی هر ${Math.round(n)} پیام تنظیم شد.`);
    await showAdMenu(ctx);
    return true;
  }

  return false;
}

// ===================== لیست/مدیریت تبلیغ‌های موجود =====================

function adLabel(ad) {
  const preview = ad.content.length > 30 ? `${ad.content.slice(0, 30)}…` : ad.content;
  return `${ad.enabled ? '✅' : '⛔️'} #${ad.id} ${preview}`;
}

async function showAdList(ctx) {
  const ads = await adService.listAds();
  if (!ads.length) {
    await ack(ctx, 'هنوز هیچ تبلیغی ساخته نشده.', true);
    await showAdMenu(ctx);
    return;
  }
  const keyboard = ads.map((ad) => [{ text: adLabel(ad), callback_data: `ad_open:${ad.id}` }]);
  keyboard.push([{ text: '⬅️ بازگشت', callback_data: 'ad_menu' }]);
  await showScreen(ctx, '📋 لیست تبلیغ‌ها (برای مدیریت هر کدوم روش بزن):', keyboard);
}

async function openAd(ctx, id) {
  const ad = await adService.getAd(id);
  if (!ad) {
    await ack(ctx, 'این تبلیغ دیگه وجود نداره.', true);
    await showAdList(ctx);
    return;
  }
  const buttonsInfo = ad.buttons.length
    ? ad.buttons.map((b, i) => `${i + 1}. ${b.text} → ${b.url}`).join('\n')
    : 'بدون دکمه';
  const text =
    `📢 تبلیغ #${ad.id}\n` +
    `وضعیت: ${ad.enabled ? '✅ فعال' : '⛔️ غیرفعال'}\n\n` +
    `متن:\n${ad.content}\n\n` +
    `دکمه‌ها:\n${buttonsInfo}`;
  const keyboard = [
    [{ text: ad.enabled ? '⛔️ غیرفعال کن' : '✅ فعال کن', callback_data: `ad_toggle:${ad.id}` }],
    [{ text: '🗑 حذف این تبلیغ', callback_data: `ad_del:${ad.id}` }],
    [{ text: '⬅️ بازگشت به لیست', callback_data: 'ad_list' }],
  ];
  await showScreen(ctx, text, keyboard);
}

async function toggleAd(ctx, id) {
  const ad = await adService.getAd(id);
  if (!ad) {
    await ack(ctx, 'این تبلیغ دیگه وجود نداره.', true);
    await showAdList(ctx);
    return;
  }
  await adService.setEnabled(id, !ad.enabled);
  await ack(ctx, !ad.enabled ? '✅ فعال شد.' : '⛔️ غیرفعال شد.');
  await openAd(ctx, id);
}

async function confirmDelete(ctx, id) {
  await ack(ctx);
  await ctx
    .editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: '✅ بله، حذف کن', callback_data: `ad_delok:${id}` }],
        [{ text: '↩️ نه، نگه دار', callback_data: `ad_open:${id}` }],
      ],
    })
    .catch(() => {});
}

async function deleteAdConfirmed(ctx, id) {
  const ok = await adService.deleteAd(id);
  await ack(ctx, ok ? '🗑 حذف شد.' : 'این تبلیغ قبلاً حذف شده بود.');
  await showAdList(ctx);
}

// ===================== مسیریاب callback =====================

async function handleCallback(ctx, action, args) {
  if (!isPrivateMother(ctx)) {
    await ack(ctx, 'این بخش فقط برای ادمین مادر و فقط در پیوی ربات در دسترسه 🚫', true);
    return;
  }

  switch (action) {
    case 'ad_menu':
      endSession(ctx.from.id);
      await ack(ctx);
      await showAdMenu(ctx);
      return;

    case 'ad_create':
      await ack(ctx);
      await startCreate(ctx);
      return;

    case 'ad_add_button': {
      const s = sessions.get(ctx.from.id);
      if (!s || s.step !== 'buttons') {
        await ack(ctx, 'این جلسه تموم شده، از منو دوباره شروع کن.', true);
        return;
      }
      await ack(ctx);
      s.step = 'button_text';
      await ctx.reply('متن دکمه رو بفرست (مثلاً: کانال ما):');
      return;
    }

    case 'ad_undo_button': {
      const s = sessions.get(ctx.from.id);
      if (!s || s.step !== 'buttons') {
        await ack(ctx, 'این جلسه تموم شده، از منو دوباره شروع کن.', true);
        return;
      }
      s.buttons.pop();
      await ack(ctx);
      const { text, keyboard } = buttonMenuView(s);
      await showScreen(ctx, text, keyboard);
      return;
    }

    case 'ad_save': {
      const s = sessions.get(ctx.from.id);
      if (!s || s.step !== 'buttons') {
        await ack(ctx, 'این جلسه تموم شده، از منو دوباره شروع کن.', true);
        return;
      }
      const id = await adService.createAd({ content: s.content, buttons: s.buttons, createdBy: ctx.from.id });
      endSession(ctx.from.id);
      await ack(ctx, '✅ تبلیغ ذخیره شد.');
      await showScreen(ctx, `✅ تبلیغ #${id} ساخته و فعال شد.`, [
        [{ text: '📋 لیست تبلیغ‌ها', callback_data: 'ad_list' }],
        [{ text: '⬅️ بازگشت', callback_data: 'ad_menu' }],
      ]);
      return;
    }

    case 'ad_cancel':
      endSession(ctx.from.id);
      await ack(ctx, 'لغو شد.');
      await showAdMenu(ctx);
      return;

    case 'ad_set_interval':
      sessions.set(ctx.from.id, { step: 'interval' });
      await ack(ctx);
      await showScreen(ctx, '⏱ عدد فاصله ارسال رو بفرست (مثلاً 100 یعنی هر 100 پیام یک تبلیغ فرستاده بشه):', [
        [{ text: '❌ لغو', callback_data: 'ad_menu' }],
      ]);
      return;

    case 'ad_list':
      await showAdList(ctx);
      return;
    case 'ad_open':
      await ack(ctx);
      await openAd(ctx, Number(args[0]));
      return;
    case 'ad_toggle':
      await toggleAd(ctx, Number(args[0]));
      return;
    case 'ad_del':
      await confirmDelete(ctx, Number(args[0]));
      return;
    case 'ad_delok':
      await deleteAdConfirmed(ctx, Number(args[0]));
      return;

    default:
      await ack(ctx);
  }
}

module.exports = { handleIncomingText, handleCallback, endSession };
