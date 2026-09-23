// پنل مدیریت عکس و استیکر (فقط ادمین مادر، فقط در پیوی ربات).
//
// - عکس‌ها  : برای شوخی «پام پلیس». هر عکس یک آیتم مستقل است.
// - استیکرها: برای «ارسال استیکر بعد از N پیام». دو نوع بسته دارد:
//       تکی      (single)   → هر استیکری که بفرستی یک بسته‌ی مستقل می‌شود.
//       چندبخشی (sequence) → چند استیکر به ترتیب جمع می‌شوند و با دکمه «ذخیره بسته» یک بسته می‌شوند.
//
// این فایل همچنین ریشه‌ی پنل در پیوی ("لیزه پنل") را می‌سازد:
//   - برای ادمین مادر: یک منوی اصلی با بخش‌های «مدیریت مقام‌ها»، «مدیریت عکس‌ها»،
//     «مدیریت استیکرها»، «مدیریت تبلیغات» و «تست صحبت».
//   - برای مقام‌دارانی که فقط دسترسی panelAccess دارند: مستقیم لیست گروه‌های مجازشان
//     (همون چیزی که قبلاً از منوی اصلی می‌دیدند، الان زیر «مدیریت مقام‌ها»ست).
// طبق نیازمندی، پنل دیگر از داخل خود گروه باز نمی‌شود؛ فقط از پیوی ربات در دسترس است.
//
// وضعیت «حالت افزودن» (session) فقط در RAM نگهداری می‌شود و بعد از ۳۰ دقیقه بی‌فعالیتی یا ری‌استارت ربات
// پاک می‌شود؛ خود عکس‌ها/استیکرهای ذخیره‌شده در دیتابیس می‌مانند.
const roleService = require('../services/roleService');
const groupRegistryService = require('../services/groupRegistryService');
const mediaService = require('../services/mediaService');
const config = require('../config');
const adPanelHandlers = require('./adPanelHandlers');
const panelHandlers = require('./panelHandlers');
const { t } = require('../utils/messages');

const SESSION_TTL_MS = 30 * 60 * 1000;
const STATUS_DEBOUNCE_MS = 700; // برای آلبوم/ارسال پشت‌سرهم: فقط یک پیام وضعیت بعد از آخرین آیتم
const PAGE_SIZE = 8;

const HINT_NO_SESSION =
  'برای افزودن عکس یا استیکر، اول توی همین پیوی بنویس «لیزه پنل» و از بخش «مدیریت عکس‌ها» یا «مدیریت استیکرها» گزینه‌ی افزودن رو بزن.';

const sessions = new Map(); // userId -> session
const previews = new Map(); // userId -> { ids: [messageId...] } پیام‌های استیکر پیش‌نمایش

// ===================== ابزارهای کمکی =====================

function isPrivateMother(ctx) {
  return Boolean(
    ctx.chat && ctx.chat.type === 'private' && ctx.from && roleService.isMotherAdmin(ctx.from.id)
  );
}

/** answerCbQuery فقط یک‌بار برای هر callback اجرا می‌شود (اولین فراخوانی برنده است) */
async function ack(ctx, text, alert = false) {
  if (!ctx.state) ctx.state = {};
  if (ctx.state.mediaAcked) return;
  ctx.state.mediaAcked = true;
  await ctx.answerCbQuery(text, { show_alert: alert }).catch(() => {});
}

function getSession(userId) {
  const s = sessions.get(userId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    endSession(userId);
    return null;
  }
  return s;
}

function touch(s) {
  s.expiresAt = Date.now() + SESSION_TTL_MS;
}

function startSession(userId, data) {
  endSession(userId);
  const s = { ...data, active: true, timer: null, chain: Promise.resolve(), statusMsgId: null };
  touch(s);
  sessions.set(userId, s);
  return s;
}

function endSession(userId) {
  const s = sessions.get(userId);
  if (!s) return null;
  s.active = false;
  clearTimeout(s.timer);
  sessions.delete(userId);
  return s;
}

/**
 * نمایش یک «صفحه» (متن + دکمه‌ها):
 * - اگر از دکمه‌ی یک پیام متنی آمده‌ایم، همان پیام ویرایش می‌شود.
 * - اگر پیام قبلی عکس بود (مثلاً نمایش عکس‌ها)، حذف می‌شود و پیام جدید فرستاده می‌شود.
 * شناسه‌ی پیام نمایش‌داده‌شده را برمی‌گرداند.
 */
async function showScreen(ctx, text, keyboard) {
  const extra = { reply_markup: { inline_keyboard: keyboard } };
  const msg = ctx.callbackQuery && ctx.callbackQuery.message;
  if (msg) {
    if (typeof msg.text === 'string') {
      try {
        await ctx.editMessageText(text, extra);
        return msg.message_id;
      } catch (err) {
        const desc = String(err.description || err.message || '').toLowerCase();
        if (desc.includes('not modified')) return msg.message_id;
        // در غیر این صورت پیام جدید می‌فرستیم
      }
    } else {
      await ctx.deleteMessage().catch(() => {});
    }
  }
  // ارسال پیام جدید با کیبورد خالی (بدون هیچ دکمه‌ای) → اصلاً reply_markup نمی‌فرستیم
  const sent = await ctx.reply(text, keyboard.length ? extra : {});
  return sent.message_id;
}

async function cleanupPreviews(telegram, chatId, userId) {
  const p = previews.get(userId);
  if (!p) return;
  previews.delete(userId);
  for (const id of p.ids) {
    // eslint-disable-next-line no-await-in-loop
    await telegram.deleteMessage(chatId, id).catch(() => {});
  }
}

// ===================== پیام «وضعیت» حالت افزودن =====================

function statusView(s) {
  if (s.mode === 'photos') {
    let text = '🖼 حالت افزودن عکس فعاله.\n\n';
    text += s.added || s.dup ? `✅ ذخیره‌شده در این جلسه: ${s.added}\n` : '';
    text += s.dup ? `♻️ تکراری (قبلاً ذخیره شده بود): ${s.dup}\n` : '';
    text += '\nعکس‌ها رو یکی‌یکی یا چندتا با هم (آلبوم) بفرست. حتماً به‌صورت «عکس» بفرست، نه «فایل».\nوقتی تموم شد «پایان» رو بزن.';
    return { text, keyboard: [[{ text: '✅ پایان', callback_data: 'media_done:photos' }]] };
  }

  if (s.mode === 'st_single') {
    let text = '🎭 حالت افزودن استیکر تکی فعاله.\n\n';
    text += s.added || s.dup ? `✅ ذخیره‌شده در این جلسه: ${s.added}\n` : '';
    text += s.dup ? `♻️ تکراری (قبلاً ذخیره شده بود): ${s.dup}\n` : '';
    text += '\nهر استیکری که بفرستی، یک بسته‌ی مستقل ذخیره می‌شه. وقتی تموم شد «پایان» رو بزن.';
    return { text, keyboard: [[{ text: '✅ پایان', callback_data: 'media_done:stickers' }]] };
  }

  // st_seq
  const n = s.parts.length;
  let text = '🧩 حالت ساخت بسته‌ی چندبخشی فعاله.\n\n';
  text += s.saved ? `📦 بسته‌های ذخیره‌شده در این جلسه: ${s.saved}\n` : '';
  if (n) {
    text += `🔢 استیکرهای بسته‌ی فعلی: ${n} (به همون ترتیبی که فرستادی)\n\nاستیکر بعدی رو بفرست یا بسته رو ذخیره کن.`;
    text += '\n⚠️ اگه «پایان» بزنی و ذخیره نکرده باشی، این بسته دور ریخته می‌شه.';
  } else {
    text += 'استیکرها رو به ترتیب بفرست (بخش ۱، بخش ۲، ...). حداقل ۲ استیکر لازمه.\nبعد از آخرین بخش، «ذخیره بسته» رو بزن.';
  }
  const keyboard = [];
  if (n) {
    keyboard.push([
      { text: '💾 ذخیره بسته', callback_data: 'media_st_seq_save' },
      { text: '↩️ حذف آخرین بخش', callback_data: 'media_st_seq_undo' },
    ]);
    keyboard.push([{ text: '❌ لغو این بسته', callback_data: 'media_st_seq_cancel' }]);
  }
  keyboard.push([{ text: '✅ پایان', callback_data: 'media_done:stickers' }]);
  return { text, keyboard };
}

/** پیام وضعیت جدید در انتهای چت می‌فرستد و قبلی را پاک می‌کند (تا دکمه‌ها همیشه پایین چت باشند) */
async function renderStatus(telegram, chatId, s) {
  if (!s.active) return;
  const { text, keyboard } = statusView(s);
  if (s.statusMsgId) await telegram.deleteMessage(chatId, s.statusMsgId).catch(() => {});
  const sent = await telegram.sendMessage(chatId, text, { reply_markup: { inline_keyboard: keyboard } });
  s.statusMsgId = sent.message_id;
  if (!s.active) await telegram.deleteMessage(chatId, sent.message_id).catch(() => {});
}

function scheduleStatus(telegram, chatId, s, delay = STATUS_DEBOUNCE_MS) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.chain = s.chain
      .then(() => renderStatus(telegram, chatId, s))
      .catch((err) => console.error('[mediaPanel] خطا در به‌روزرسانی پیام وضعیت:', err.message));
  }, delay);
}

/** بعد از فشردن یک دکمه‌ی روی پیام وضعیت، همان پیام را در جا به‌روز می‌کند */
async function refreshStatusInPlace(ctx, s) {
  const { text, keyboard } = statusView(s);
  s.statusMsgId = ctx.callbackQuery.message.message_id;
  await ctx.editMessageText(text, { reply_markup: { inline_keyboard: keyboard } }).catch(() => {});
}

// ===================== منوها =====================

/** ریشه‌ی پنل در پیوی. ادمین مادر منوی کامل می‌بیند؛ بقیه (اگر panelAccess داشته باشند) مستقیم لیست گروه‌ها را می‌بینند. */
async function openPrivateRoot(ctx) {
  const userId = ctx.from.id;
  const isMother = roleService.isMotherAdmin(userId);
  if (isMother) {
    endSession(userId);
    adPanelHandlers.endSession(userId);
    await cleanupPreviews(ctx.telegram, ctx.chat.id, userId);
  }

  if (!isMother) {
    await showRankManagementGroups(ctx);
    return;
  }

  const keyboard = [
    [{ text: '🎖 مدیریت مقام‌ها', callback_data: 'rank_mgmt_root' }],
    [{ text: '🖼 مدیریت عکس‌ها (پام پلیس)', callback_data: 'media_photos_menu' }],
    [{ text: '🎭 مدیریت استیکرها', callback_data: 'media_st_menu' }],
    [{ text: '📢 مدیریت تبلیغات', callback_data: 'ad_menu' }],
    [{ text: '💬 تست صحبت با الینالیزه', callback_data: 'chat_start' }],
  ];
  await showScreen(ctx, '🛠 پنل مدیریت ربات:', keyboard);
}

// ===================== مدیریت مقام‌ها: لیست گروه‌ها و اطلاعات گروه =====================

/** لیست گروه‌هایی که کاربر بهشون دسترسی پنل داره؛ گروه اصلی (MAIN_GROUP_ID در .env) با ✅ و اول لیست میاد */
async function showRankManagementGroups(ctx) {
  const userId = ctx.from.id;
  const isMother = roleService.isMotherAdmin(userId);
  const groups = await groupRegistryService.listGroupsForPanelAccess(userId, isMother);

  if (!groups.length) {
    await showScreen(
      ctx,
      'هیچ گروهی که توش دسترسی مدیریت مقام‌ها داشته باشی پیدا نکردم.',
      isMother ? [[{ text: '⬅️ بازگشت', callback_data: 'media_root' }]] : []
    );
    return;
  }

  const mainId = config.mainGroupId;
  const sorted = [...groups].sort((a, b) => {
    const aMain = mainId && Number(a.group_id) === Number(mainId) ? 0 : 1;
    const bMain = mainId && Number(b.group_id) === Number(mainId) ? 0 : 1;
    return aMain - bMain;
  });

  const keyboard = sorted.map((g) => {
    const isMain = mainId && Number(g.group_id) === Number(mainId);
    const label = `${isMain ? '✅ ' : ''}${g.title || String(g.group_id)}`;
    return [{ text: label, callback_data: `panel_select_group:${g.group_id}` }];
  });
  if (isMother) keyboard.push([{ text: '⬅️ بازگشت', callback_data: 'media_root' }]);

  await showScreen(ctx, '🎖 مدیریت مقام‌ها\nکدوم گروه رو می‌خوای مدیریت کنی؟', keyboard);
}

/** نمایش اطلاعات کلی یک گروه قبل از ورود به مدیریت مقام‌هاش (اسم، آیدی، تعداد اعضا، لینک در صورت وجود) */
async function showGroupOverview(ctx, groupId) {
  if (!(await panelHandlers.canOpenPanel(groupId, ctx.from.id))) {
    await ctx.reply(t('general.noPermission'));
    return;
  }

  const chat = await ctx.telegram.getChat(groupId).catch(() => null);
  let inviteLink = (chat && chat.invite_link) || null;
  if (!inviteLink) {
    inviteLink = await ctx.telegram.exportChatInviteLink(groupId).catch(() => null);
  }
  const memberCount = await ctx.telegram.getChatMembersCount(groupId).catch(() => null);
  const mainId = config.mainGroupId;
  const isMain = mainId && Number(groupId) === Number(mainId);

  let text = `🏘 اطلاعات گروه${isMain ? ' (گروه اصلی ✅)' : ''}\n\n`;
  text += `نام: ${(chat && chat.title) || 'نامشخص'}\n`;
  text += `آیدی: ${groupId}\n`;
  text += `تعداد اعضا: ${memberCount !== null ? memberCount : 'نامشخص'}\n`;
  text += inviteLink
    ? `لینک: ${inviteLink}`
    : 'لینک دعوت در دسترس نیست (احتمالاً ربات دسترسی «دعوت با لینک» رو در این گروه نداره).';

  await showScreen(ctx, text, [
    [{ text: '🎖 مدیریت مقام‌های این گروه', callback_data: `panel_rank_group:${groupId}` }],
    [{ text: '⬅️ بازگشت به لیست گروه‌ها', callback_data: 'rank_mgmt_root' }],
  ]);
}

async function showPhotosMenu(ctx) {
  const c = await mediaService.getCounts();
  let text = `🖼 مدیریت عکس‌های «پام پلیس»\n\n📷 عکس‌های ذخیره‌شده (دیتابیس): ${c.photosDb}`;
  if (c.photosFile) text += `\n📄 عکس‌های داخل فایل pamPolicePhotos.json: ${c.photosFile} (از پنل حذف نمی‌شن)`;
  await showScreen(ctx, text, [
    [{ text: '➕ افزودن عکس', callback_data: 'media_photo_add' }],
    [{ text: '📋 مشاهده و حذف', callback_data: 'media_photo_view:0' }],
    [{ text: '⬅️ بازگشت', callback_data: 'media_root' }],
  ]);
}

async function showStickersMenu(ctx) {
  const c = await mediaService.getCounts();
  let text =
    '🎭 مدیریت استیکرها\n\n' +
    `• استیکر تکی: ${c.singleDb}\n` +
    `• بسته‌ی چندبخشی: ${c.sequenceDb}`;
  if (c.packsFile) text += `\n📄 بسته‌های داخل فایل stickers.json: ${c.packsFile} (از پنل حذف نمی‌شن)`;
  text +=
    '\n\nتکی: هر استیکر یک بسته‌ی مستقل است.\nچندبخشی: چند استیکر که پشت‌سرهم و به ترتیب فرستاده می‌شن (مثلاً یک کاراکتر که هر تکه‌ی بدنش یک استیکره).';
  await showScreen(ctx, text, [
    [{ text: '➕ افزودن استیکر تکی', callback_data: 'media_st_add_single' }],
    [{ text: '🧩 افزودن بسته‌ی چندبخشی', callback_data: 'media_st_add_seq' }],
    [{ text: '📋 مشاهده و حذف', callback_data: 'media_st_list:0' }],
    [{ text: '⬅️ بازگشت', callback_data: 'media_root' }],
  ]);
}

// ===================== دریافت عکس / استیکر از ادمین =====================

/** بعد از bot.on('photo') صدا زده می‌شود. برمی‌گرداند true اگر پیام مربوط به همین پنل بود. */
async function handleIncomingPhoto(ctx) {
  if (!isPrivateMother(ctx)) return false;

  const s = getSession(ctx.from.id);
  if (!s) {
    await ctx.reply(HINT_NO_SESSION);
    return true;
  }
  if (s.mode !== 'photos') {
    await ctx.reply('الان در حالت افزودن «استیکر» هستی. برای عکس، اول «پایان» رو بزن و از منوی عکس‌ها شروع کن.');
    return true;
  }

  const sizes = ctx.message.photo;
  const best = sizes[sizes.length - 1]; // بزرگ‌ترین نسخه
  const inserted = await mediaService.addPhoto({
    fileId: best.file_id,
    fileUniqueId: best.file_unique_id,
    addedBy: ctx.from.id,
  });
  if (inserted) s.added += 1;
  else s.dup += 1;

  touch(s);
  scheduleStatus(ctx.telegram, ctx.chat.id, s);
  return true;
}

/** بعد از bot.on('sticker') صدا زده می‌شود. */
async function handleIncomingSticker(ctx) {
  if (!isPrivateMother(ctx)) return false;

  const s = getSession(ctx.from.id);
  if (!s) {
    await ctx.reply(HINT_NO_SESSION);
    return true;
  }
  if (s.mode === 'photos') {
    await ctx.reply('الان در حالت افزودن «عکس» هستی. برای استیکر، اول «پایان» رو بزن و از منوی استیکرها شروع کن.');
    return true;
  }

  const sticker = ctx.message.sticker;
  if (sticker.type === 'custom_emoji') {
    await ctx.reply('استیکر ایموجی سفارشی (Custom Emoji) قابل ارسال به‌عنوان استیکر نیست؛ یک استیکر معمولی بفرست.');
    return true;
  }

  if (s.mode === 'st_single') {
    const res = await mediaService.addStickerPack({
      type: 'single',
      parts: [{ fileId: sticker.file_id, uniqueId: sticker.file_unique_id }],
      addedBy: ctx.from.id,
    });
    if (res.inserted) s.added += 1;
    else s.dup += 1;
  } else {
    // چندبخشی: ترتیب بر اساس message_id است، پس حتی اگر آپدیت‌ها هم‌زمان پردازش شوند ترتیب درست می‌ماند
    s.parts.push({
      fileId: sticker.file_id,
      uniqueId: sticker.file_unique_id,
      messageId: ctx.message.message_id,
    });
  }

  touch(s);
  scheduleStatus(ctx.telegram, ctx.chat.id, s, s.mode === 'st_seq' ? 350 : STATUS_DEBOUNCE_MS);
  return true;
}

// ===================== عکس‌ها: مشاهده و حذف =====================

function photoKeyboard(photos, idx) {
  const n = photos.length;
  const rows = [];
  if (n > 1) {
    rows.push([
      { text: '⬅️ قبلی', callback_data: `media_photo_view:${(idx - 1 + n) % n}` },
      { text: 'بعدی ➡️', callback_data: `media_photo_view:${(idx + 1) % n}` },
    ]);
  }
  rows.push([{ text: '🗑 حذف این عکس', callback_data: `media_photo_del:${photos[idx].id}:${idx}` }]);
  rows.push([{ text: '⬅️ بازگشت به منو', callback_data: 'media_photos_menu' }]);
  return rows;
}

async function showPhoto(ctx, idxRaw) {
  const photos = await mediaService.listPhotos();
  if (!photos.length) {
    await ack(ctx, 'هنوز هیچ عکسی توی دیتابیس ذخیره نشده.', true);
    await showPhotosMenu(ctx);
    return;
  }
  await ack(ctx);
  const idx = Math.max(0, Math.min(photos.length - 1, Number(idxRaw) || 0));
  const p = photos[idx];
  const caption = `🖼 عکس ${idx + 1} از ${photos.length} (شناسه #${p.id})`;
  const reply_markup = { inline_keyboard: photoKeyboard(photos, idx) };
  const msg = ctx.callbackQuery.message;

  try {
    if (msg && msg.photo) {
      await ctx.editMessageMedia({ type: 'photo', media: p.file_id, caption }, { reply_markup });
    } else {
      await ctx.deleteMessage().catch(() => {});
      await ctx.replyWithPhoto(p.file_id, { caption, reply_markup });
    }
  } catch (err) {
    const desc = String(err.description || err.message || '').toLowerCase();
    if (desc.includes('not modified')) return;
    console.error('[mediaPanel] نمایش عکس ناموفق بود:', err.message);
    // مثلاً وقتی توکن ربات عوض شده و file_id قدیمی معتبر نیست؛ حداقل اجازه‌ی حذفش را می‌دهیم
    await ctx.deleteMessage().catch(() => {});
    await ctx.reply(`⚠️ عکس #${p.id} قابل نمایش نیست (احتمالاً file_id برای این ربات معتبر نیست).`, { reply_markup });
  }
}

async function confirmPhotoDelete(ctx, id, idx) {
  await ack(ctx);
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: '✅ بله، حذف کن', callback_data: `media_photo_delok:${id}:${idx}` }],
      [{ text: '↩️ نه، نگه دار', callback_data: `media_photo_keep:${id}:${idx}` }],
    ],
  }).catch(() => {});
}

async function keepPhoto(ctx, idx) {
  await ack(ctx);
  const photos = await mediaService.listPhotos();
  if (!photos.length) return showPhotosMenu(ctx);
  const i = Math.max(0, Math.min(photos.length - 1, Number(idx) || 0));
  await ctx.editMessageReplyMarkup({ inline_keyboard: photoKeyboard(photos, i) }).catch(() => {});
  return undefined;
}

async function deletePhoto(ctx, id, idx) {
  const ok = await mediaService.deletePhoto(id);
  await ack(ctx, ok ? '🗑 حذف شد.' : 'این عکس قبلاً حذف شده بود.');
  await showPhoto(ctx, idx); // اگر عکسی نمانده باشد خودش منو را نشان می‌دهد
}

// ===================== استیکرها: مشاهده و حذف =====================

function packLabel(p) {
  return p.pack_type === 'single' ? 'تکی' : `چندبخشی (${p.file_ids.length} بخش)`;
}

async function showStickerList(ctx, pageRaw) {
  const packs = await mediaService.listStickerPacks();
  if (!packs.length) {
    await ack(ctx, 'هنوز هیچ استیکری توی دیتابیس ذخیره نشده.', true);
    await showStickersMenu(ctx);
    return;
  }
  await ack(ctx);
  const totalPages = Math.ceil(packs.length / PAGE_SIZE);
  const page = Math.max(0, Math.min(totalPages - 1, Number(pageRaw) || 0));
  const slice = packs.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const keyboard = slice.map((p) => [
    { text: `#${p.id} • ${packLabel(p)}`, callback_data: `media_st_open:${p.id}:${page}` },
  ]);
  if (totalPages > 1) {
    const nav = [];
    if (page > 0) nav.push({ text: '⬅️ قبلی', callback_data: `media_st_list:${page - 1}` });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: 'media_noop' });
    if (page < totalPages - 1) nav.push({ text: 'بعدی ➡️', callback_data: `media_st_list:${page + 1}` });
    keyboard.push(nav);
  }
  keyboard.push([{ text: '⬅️ بازگشت به منو', callback_data: 'media_st_menu' }]);

  await showScreen(ctx, `📋 بسته‌های استیکر ذخیره‌شده (${packs.length} مورد)\nروی هر مورد بزن تا پیش‌نمایشش رو ببینی:`, keyboard);
}

function packKeyboard(id, page) {
  return [
    [{ text: '🗑 حذف این بسته', callback_data: `media_st_del:${id}:${page}` }],
    [{ text: '⬅️ بازگشت به لیست', callback_data: `media_st_list:${page}` }],
  ];
}

async function openStickerPack(ctx, id, page) {
  const pack = await mediaService.getStickerPack(id);
  if (!pack) {
    await ack(ctx, 'این بسته دیگه وجود نداره.', true);
    await showStickerList(ctx, page);
    return;
  }
  await ack(ctx);

  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  await cleanupPreviews(ctx.telegram, chatId, userId);

  // پیام لیست حذف می‌شود تا پیش‌نمایش استیکرها و پیام کنترل، به ترتیب در انتهای چت بیایند
  await ctx.deleteMessage().catch(() => {});

  const ids = [];
  let failed = 0;
  for (const fileId of pack.file_ids) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const sent = await ctx.telegram.sendSticker(chatId, fileId);
      ids.push(sent.message_id);
    } catch (err) {
      failed += 1;
      console.error('[mediaPanel] پیش‌نمایش استیکر ناموفق بود:', err.message);
    }
  }
  previews.set(userId, { ids });

  let text = `🎭 بسته #${pack.id} — ${packLabel(pack)}`;
  if (failed) text += `\n⚠️ ${failed} استیکر قابل نمایش نبود (احتمالاً file_id برای این ربات معتبر نیست).`;
  await ctx.reply(text, { reply_markup: { inline_keyboard: packKeyboard(pack.id, page) } });
}

async function confirmStickerDelete(ctx, id, page) {
  await ack(ctx);
  await ctx.editMessageReplyMarkup({
    inline_keyboard: [
      [{ text: '✅ بله، حذف کن', callback_data: `media_st_delok:${id}:${page}` }],
      [{ text: '↩️ نه، نگه دار', callback_data: `media_st_keep:${id}:${page}` }],
    ],
  }).catch(() => {});
}

async function keepSticker(ctx, id, page) {
  await ack(ctx);
  await ctx.editMessageReplyMarkup({ inline_keyboard: packKeyboard(id, page) }).catch(() => {});
}

async function deleteStickerPack(ctx, id, page) {
  const ok = await mediaService.deleteStickerPack(id);
  await ack(ctx, ok ? '🗑 حذف شد.' : 'این بسته قبلاً حذف شده بود.');
  await showStickerList(ctx, page); // اگر بسته‌ای نمانده باشد خودش منو را نشان می‌دهد
}

// ===================== مسیریاب callback ها =====================

// این اکشن‌ها پیش‌نمایش‌های استیکر را نگه می‌دارند؛ برای بقیه‌ی اکشن‌ها پیش‌نمایش‌ها پاک می‌شوند
const KEEP_PREVIEWS = new Set(['media_st_open', 'media_st_del', 'media_st_keep']);

async function handleCallback(ctx, action, args) {
  if (!isPrivateMother(ctx)) {
    await ack(ctx, 'این بخش فقط برای ادمین مادر و فقط در پیوی ربات در دسترسه 🚫', true);
    return;
  }

  const userId = ctx.from.id;
  if (!KEEP_PREVIEWS.has(action)) await cleanupPreviews(ctx.telegram, ctx.chat.id, userId);

  const expired = () => ack(ctx, 'این جلسه تموم شده؛ از منو دوباره شروع کن.', true);

  switch (action) {
    case 'media_noop':
      await ack(ctx);
      return;

    case 'media_root':
      await ack(ctx);
      await openPrivateRoot(ctx);
      return;

    // ---------- منوها ----------
    case 'media_photos_menu':
      await ack(ctx);
      endSession(userId);
      await showPhotosMenu(ctx);
      return;
    case 'media_st_menu':
      await ack(ctx);
      endSession(userId);
      await showStickersMenu(ctx);
      return;

    // ---------- پایان حالت افزودن ----------
    case 'media_done': {
      await ack(ctx);
      endSession(userId);
      if (args[0] === 'photos') await showPhotosMenu(ctx);
      else await showStickersMenu(ctx);
      return;
    }

    // ---------- عکس ----------
    case 'media_photo_add': {
      await ack(ctx);
      const s = startSession(userId, { mode: 'photos', added: 0, dup: 0 });
      const { text, keyboard } = statusView(s);
      s.statusMsgId = await showScreen(ctx, text, keyboard);
      return;
    }
    case 'media_photo_view':
      await showPhoto(ctx, args[0]);
      return;
    case 'media_photo_del':
      await confirmPhotoDelete(ctx, Number(args[0]), Number(args[1]));
      return;
    case 'media_photo_keep':
      await keepPhoto(ctx, args[1]);
      return;
    case 'media_photo_delok':
      await deletePhoto(ctx, Number(args[0]), Number(args[1]));
      return;

    // ---------- استیکر: افزودن ----------
    case 'media_st_add_single': {
      await ack(ctx);
      const s = startSession(userId, { mode: 'st_single', added: 0, dup: 0 });
      const { text, keyboard } = statusView(s);
      s.statusMsgId = await showScreen(ctx, text, keyboard);
      return;
    }
    case 'media_st_add_seq': {
      await ack(ctx);
      const s = startSession(userId, { mode: 'st_seq', parts: [], saved: 0 });
      const { text, keyboard } = statusView(s);
      s.statusMsgId = await showScreen(ctx, text, keyboard);
      return;
    }
    case 'media_st_seq_save': {
      const s = getSession(userId);
      if (!s || s.mode !== 'st_seq') return expired();
      if (s.parts.length < 2) {
        await ack(ctx, 'برای بسته‌ی چندبخشی حداقل ۲ استیکر لازمه. (برای یک استیکر از «استیکر تکی» استفاده کن)', true);
        return undefined;
      }
      const parts = [...s.parts].sort((a, b) => a.messageId - b.messageId);
      const res = await mediaService.addStickerPack({ type: 'sequence', parts, addedBy: userId });
      if (res.inserted) {
        s.saved += 1;
        await ack(ctx, `✅ بسته #${res.id} ذخیره شد.`);
      } else {
        await ack(ctx, 'این بسته (با همین ترتیب) قبلاً ذخیره شده بود.', true);
      }
      s.parts = [];
      touch(s);
      await refreshStatusInPlace(ctx, s);
      return undefined;
    }
    case 'media_st_seq_undo': {
      const s = getSession(userId);
      if (!s || s.mode !== 'st_seq') return expired();
      await ack(ctx);
      s.parts.sort((a, b) => a.messageId - b.messageId);
      s.parts.pop();
      touch(s);
      await refreshStatusInPlace(ctx, s);
      return undefined;
    }
    case 'media_st_seq_cancel': {
      const s = getSession(userId);
      if (!s || s.mode !== 'st_seq') return expired();
      await ack(ctx);
      s.parts = [];
      touch(s);
      await refreshStatusInPlace(ctx, s);
      return undefined;
    }

    // ---------- استیکر: مشاهده و حذف ----------
    case 'media_st_list':
      await showStickerList(ctx, args[0]);
      return;
    case 'media_st_open':
      await openStickerPack(ctx, Number(args[0]), Number(args[1]) || 0);
      return;
    case 'media_st_del':
      await confirmStickerDelete(ctx, Number(args[0]), Number(args[1]) || 0);
      return;
    case 'media_st_keep':
      await keepSticker(ctx, Number(args[0]), Number(args[1]) || 0);
      return;
    case 'media_st_delok':
      await deleteStickerPack(ctx, Number(args[0]), Number(args[1]) || 0);
      return;

    default:
      await ack(ctx);
  }
}

module.exports = {
  openPrivateRoot,
  showRankManagementGroups,
  showGroupOverview,
  handleIncomingPhoto,
  handleIncomingSticker,
  handleCallback,
};
