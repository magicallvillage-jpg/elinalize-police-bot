// «تست صحبت با الینالیزه» - فقط برای ادمین مادر و فقط در پیوی ربات.
// ادمین از پنل (لیزه پنل) دکمه‌ی «💬 تست صحبت با الینالیزه» را می‌زند و بعد از آن هر متنی که بفرستد
// مستقیم به هوش مصنوعی (با همان شخصیت personality.json) می‌رسد و جواب برمی‌گردد.
// اگر جواب نگیرد، دلیل دقیق خطا (کلید اشتباه، مدل ناموجود، سقف درخواست و ...) همان‌جا نشان داده می‌شود؛
// پس این بخش برای عیب‌یابی کامنت‌گذاری کانال هم عالی است (چون از همان aiClient و همان مدل استفاده می‌کند).
//
// حافظه‌ی گفت‌وگو فقط در RAM است و بعد از ۳۰ دقیقه بی‌فعالیتی یا ری‌استارت پاک می‌شود.
const roleService = require('../services/roleService');
const aiClient = require('../services/aiClient');
const mediaPanelHandlers = require('./mediaPanelHandlers');

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_HISTORY = 16; // ۸ رفت‌وبرگشت آخر

const sessions = new Map(); // userId -> { history, expiresAt, busy, lastMsgId }

const INTRO =
  '💬 حالت «تست صحبت با الینالیزه» فعاله.\n\n' +
  'هر چی بنویسی مستقیم به الینالیزه می‌رسه (لازم نیست اول بگی «لیزه»).\n' +
  'زیر هر جواب، اسم مدلی که جواب داده هم نوشته می‌شه.\n' +
  'برای برگشتن به منو «پایان تست» رو بزن یا بنویس «لیزه پنل».';

function isPrivateMother(ctx) {
  return Boolean(ctx.chat && ctx.chat.type === 'private' && ctx.from && roleService.isMotherAdmin(ctx.from.id));
}

function getSession(userId) {
  const s = sessions.get(userId);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(userId);
    return null;
  }
  return s;
}

function endSession(userId) {
  return sessions.delete(userId);
}

function keyboard() {
  return [
    [
      { text: '🧹 پاک کردن حافظه', callback_data: 'chat_reset' },
      { text: '✅ پایان تست', callback_data: 'chat_end' },
    ],
  ];
}

async function startChat(ctx) {
  const session = { history: [], expiresAt: Date.now() + SESSION_TTL_MS, busy: false, lastMsgId: null };
  sessions.set(ctx.from.id, session);

  const extra = { reply_markup: { inline_keyboard: keyboard() } };
  try {
    await ctx.editMessageText(INTRO, extra);
    session.lastMsgId = ctx.callbackQuery.message.message_id;
  } catch (_) {
    const sent = await ctx.reply(INTRO, extra);
    session.lastMsgId = sent.message_id;
  }
}

/**
 * پیام متنی ادمین مادر در پیوی. برمی‌گرداند true اگر این پیام مربوط به حالت تست چت بود و مصرف شد.
 */
async function handleIncomingText(ctx, text) {
  if (!isPrivateMother(ctx)) return false;
  const s = getSession(ctx.from.id);
  if (!s) return false;

  const userText = String(text || '').trim();
  if (!userText) return true;

  if (s.busy) {
    await ctx.reply('⏳ هنوز جواب پیام قبلی رو نگرفتم، یه لحظه صبر کن.');
    return true;
  }

  s.busy = true;
  s.expiresAt = Date.now() + SESSION_TTL_MS;
  ctx.sendChatAction('typing').catch(() => {});
  const typingTimer = setInterval(() => ctx.sendChatAction('typing').catch(() => {}), 4000);

  try {
    s.history.push({ role: 'user', content: userText });
    const res = await aiClient.generateChatReply(s.history);

    if (!res.text) {
      s.history.pop(); // پیام بی‌جواب در حافظه نمی‌ماند
      const reason = String(res.error || 'نامشخص').slice(0, 900);
      await ctx.reply(`❌ جواب نگرفتم.\n\nدلیل:\n${reason}`);
      return true;
    }

    s.history.push({ role: 'assistant', content: res.text });
    while (s.history.length > MAX_HISTORY) s.history.splice(0, 2);

    // دکمه‌های پیام قبلی را برمی‌داریم تا فقط زیر آخرین جواب دکمه باشد
    if (s.lastMsgId) {
      ctx.telegram.editMessageReplyMarkup(ctx.chat.id, s.lastMsgId, undefined, { inline_keyboard: [] }).catch(() => {});
    }
    const sent = await ctx.reply(`${res.text}\n\n⚙️ مدل: ${res.model}`, {
      reply_markup: { inline_keyboard: keyboard() },
    });
    s.lastMsgId = sent.message_id;
  } finally {
    clearInterval(typingTimer);
    s.busy = false;
  }
  return true;
}

/** callback های دکمه‌ها: chat_start | chat_reset | chat_end */
async function handleCallback(ctx, action) {
  if (!isPrivateMother(ctx)) {
    await ctx.answerCbQuery('این بخش فقط برای ادمین مادر و فقط در پیوی ربات در دسترسه 🚫', { show_alert: true });
    return;
  }

  switch (action) {
    case 'chat_start':
      await ctx.answerCbQuery().catch(() => {});
      await startChat(ctx);
      return;

    case 'chat_reset': {
      const s = getSession(ctx.from.id);
      if (!s) {
        await ctx.answerCbQuery('این جلسه تموم شده؛ از منوی پنل دوباره شروع کن.', { show_alert: true });
        return;
      }
      s.history = [];
      s.expiresAt = Date.now() + SESSION_TTL_MS;
      await ctx.answerCbQuery('🧹 حافظه‌ی گفت‌وگو پاک شد.');
      return;
    }

    case 'chat_end':
      endSession(ctx.from.id);
      await ctx.answerCbQuery().catch(() => {});
      await mediaPanelHandlers.openPrivateRoot(ctx);
      return;

    default:
      await ctx.answerCbQuery().catch(() => {});
  }
}

module.exports = { handleIncomingText, handleCallback, endSession };
