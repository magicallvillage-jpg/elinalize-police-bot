// نقطه ورود اصلی ربات الینالیزه.
// این فایل: Telegraf را راه‌اندازی می‌کند، جداول دیتابیس را می‌سازد،
// میان‌افزارها را وصل می‌کند، پیام‌های متنی گروه و پیوی را به مسیریاب دستورات می‌فرستد،
// callback_query دکمه‌های شیشه‌ای را مدیریت می‌کند و کرون‌جاب‌های روزانه (کاهش عصبانیت) را اجرا می‌کند.
const { Telegraf } = require('telegraf');
const cron = require('node-cron');

const config = require('./config');
const { initDatabase } = require('./database/init');

const { banEnforcementMiddleware } = require('./middlewares/banEnforcementMiddleware');
const { groupRegistryMiddleware } = require('./middlewares/groupRegistryMiddleware');

const wakeWordParser = require('./handlers/wakeWordParser');
const commandRouter = require('./handlers/commandRouter');
const callbackHandler = require('./handlers/callbackHandler');
const panelHandlers = require('./handlers/panelHandlers');
const userCommands = require('./handlers/userCommands');
const meowCommands = require('./handlers/meowCommands');
const channelCommentaryHandler = require('./handlers/channelCommentaryHandler');
const funFeatures = require('./handlers/funFeatures');
const mediaPanelHandlers = require('./handlers/mediaPanelHandlers');
const chatTestHandlers = require('./handlers/chatTestHandlers');

const groupRegistryService = require('./services/groupRegistryService');
const mediaService = require('./services/mediaService');
const meowService = require('./services/meowService');
const loveAngerService = require('./services/loveAngerService');
const aiClient = require('./services/aiClient');
const { t } = require('./utils/messages');

if (!config.botToken) {
  console.error('BOT_TOKEN تنظیم نشده؛ ربات متوقف شد.');
  process.exit(1);
}

const bot = new Telegraf(config.botToken);

// --- میان‌افزارهای عمومی (روی همه آپدیت‌ها اجرا می‌شوند) ---
bot.use(groupRegistryMiddleware);
bot.use(banEnforcementMiddleware);

// --- روی هر پیام گروه (هر نوعی: متن، عکس، استیکر و ...) اجرا می‌شود ---
// ۱) تشخیص پست‌های فورواردشده خودکار از کانال تنظیم‌شده (برای کامنت‌گذاری هوش مصنوعی)
// ۲) شمارش پیام‌ها برای قابلیت‌های سرگرمی (استیکر بعد از N پیام / پام پلیس)
bot.on('message', async (ctx, next) => {
  await channelCommentaryHandler.detectAndSchedule(ctx).catch((err) => console.error('[channelCommentary]', err));
  await funFeatures.handleGroupActivity(ctx).catch((err) => console.error('[funFeatures]', err));
  return next();
});

// --- دستور /start در پیوی ---
bot.start(async (ctx) => {
  if (ctx.chat.type === 'private') {
    await ctx.reply(
      'سلام! من الینالیزه‌ام 🤖💗\n' +
        'من رو به یک گروه اضافه کن و ادمینم کن تا بتونم مدیریتش کنم.\n' +
        'داخل گروه با گفتن «لیزه» یا «الینالیزه» قبل از دستورت باهام صحبت کن (فقط فارسی).\n' +
        'اگه ادمین مادر هستی، اینجا در پیوی هم می‌تونی با نوشتن «لیزه پنل» به پنل مدیریت گروه‌هات دسترسی داشته باشی.'
    );
  }
});

// --- پیام‌های متنی گروه و پیوی ---
bot.on('text', async (ctx) => {
  const text = ctx.message.text;
  if (!text) return;

  // پیوی: دستور پنل + حالت «تست صحبت با الینالیزه» (فقط ادمین مادر)
  if (ctx.chat.type === 'private') {
    await handlePrivateText(ctx, text);
    return;
  }

  // فقط در گروه/سوپرگروه به دستورات صدا زده‌شده پاسخ می‌دهیم
  if (ctx.chat.type !== 'group' && ctx.chat.type !== 'supergroup') return;

  const groupId = ctx.chat.id;

  // ۱) آیا این پیام، پاسخ به یک force-reply در انتظار است؟ (مثل تغییر نام مقام از پنل)
  try {
    const handledRename = await panelHandlers.handleRenamePendingReply(ctx);
    if (handledRename) return;
  } catch (err) {
    console.error('[handleRenamePendingReply] خطا:', err);
  }

  // ۲) آیا این کاربر بعد از "لیزه سگتم" منتظر پاسخ "هاپ هاپ" بود؟ در این صورت همین پیام
  //    مصرف می‌شود (چه دستور دیگری باشد چه نباشد) و پردازش عادی ادامه پیدا نمی‌کند.
  try {
    const handledHop = await userCommands.resolveDogLoveChallenge(ctx, groupId);
    if (handledHop) return;
  } catch (err) {
    console.error('[resolveDogLoveChallenge] خطا:', err);
  }

  // ۳) جدید: همین منطق برای "لیزه میو" - منتظر پاسخ "میو" بعد از چالش
  try {
    const handledMeow = await meowCommands.resolveMeowChallenge(ctx, groupId);
    if (handledMeow) return;
  } catch (err) {
    console.error('[resolveMeowChallenge] خطا:', err);
  }

  const parsed = await wakeWordParser.extractCommand(groupId, text);
  if (!parsed.matched) return; // پیام عادی گروه - ربات کاری بهش نداره

  if (!parsed.rest) {
    // فقط کلمه صدا زدن به تنهایی گفته شده
    await ctx.reply('جانم؟ بعد از صدا زدنم یه دستور فارسی بنویس 🙂');
    return;
  }

  try {
    const handled = await commandRouter.routeCommand(ctx, groupId, ctx.from, parsed.rest);
    if (!handled) {
      await ctx.reply(t('general.onlyPersian'));
    }
  } catch (err) {
    console.error('[commandRouter] خطا در پردازش دستور:', err);
    await ctx.reply(t('general.actionFailed'));
  }
});

async function handlePrivateText(ctx, text) {
  const wakeWords = config.defaultWakeWords;
  const trimmed = text.trim();
  const matchedWord = wakeWords.find((w) => trimmed === w || trimmed.startsWith(w + ' '));
  const rest = matchedWord ? trimmed.slice(matchedWord.length).trim() : '';

  if (matchedWord && rest === 'پنل') {
    // منوی پنل در پیوی: لیست گروه‌ها + (برای ادمین مادر) مدیریت عکس‌ها و استیکرها + تست صحبت
    chatTestHandlers.endSession(ctx.from.id);
    await mediaPanelHandlers.openPrivateRoot(ctx);
    return;
  }

  // اگر ادمین مادر در «حالت تست صحبت» باشد، هر متن دیگری مستقیم به هوش مصنوعی می‌رود
  try {
    await chatTestHandlers.handleIncomingText(ctx, text);
  } catch (err) {
    console.error('[chatTest] خطا:', err);
    await ctx.reply(t('general.actionFailed')).catch(() => {});
  }
}

// --- عکس و استیکر در پیوی: فقط برای «حالت افزودن» پنل ادمین مادر (بقیه نادیده گرفته می‌شوند) ---
bot.on('photo', async (ctx) => {
  try {
    await mediaPanelHandlers.handleIncomingPhoto(ctx);
  } catch (err) {
    console.error('[mediaPanel:photo] خطا:', err);
    await ctx.reply(t('general.actionFailed')).catch(() => {});
  }
});

bot.on('sticker', async (ctx) => {
  try {
    await mediaPanelHandlers.handleIncomingSticker(ctx);
  } catch (err) {
    console.error('[mediaPanel:sticker] خطا:', err);
    await ctx.reply(t('general.actionFailed')).catch(() => {});
  }
});

// --- callback_query دکمه‌های شیشه‌ای ---
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  if (data.startsWith('panel_select_group:')) {
    const groupId = Number(data.split(':')[1]);
    await ctx.answerCbQuery();
    await panelHandlers.openPanel(ctx, groupId);
    return;
  }
  await callbackHandler.handleCallbackQuery(ctx);
});

// --- کرون‌جاب روزانه: کاهش ۵٪ عصبانیت همه کاربران (ساعت ۰۰:۰۰) ---
cron.schedule('0 0 * * *', async () => {
  try {
    await loveAngerService.applyDailyAngerDecay();
    console.log('[cron] کاهش روزانه عصبانیت انجام شد.');
  } catch (err) {
    console.error('[cron] خطا در کاهش روزانه عصبانیت:', err.message);
  }
});

// --- کرون‌جاب هر ۳۰ ثانیه: پردازش صف کامنت‌گذاری هوش مصنوعی روی پست‌های کانال ---
cron.schedule('*/30 * * * * *', async () => {
  if (!config.channelCommentary.enabled) return;
  try {
    await channelCommentaryHandler.processDuePosts(bot.telegram);
  } catch (err) {
    console.error('[cron] خطا در پردازش صف کامنت کانال:', err.message);
  }
});

/** گزارش وضعیت تنظیمات کامنت‌گذاری در لاگ هنگام روشن شدن (برای عیب‌یابی سریع) */
function logCommentaryStatus() {
  const c = config.channelCommentary;
  console.log(
    `[channelCommentary] enabled=${c.enabled} | channelId=${c.channelId} | apiKey=${
      c.openRouterApiKey ? 'set' : 'MISSING'
    } | models=${c.openRouterModel} | delayMs=${c.delayMs}`
  );
  if (!c.enabled) {
    console.log('[channelCommentary] خاموش است (CHANNEL_COMMENTARY_ENABLED=true نیست).');
    return;
  }
  if (!c.channelId) console.error('[channelCommentary] ❌ CHANNEL_ID تنظیم نشده.');
  if (!c.openRouterApiKey) console.error('[channelCommentary] ❌ OPENROUTER_API_KEY تنظیم نشده.');
  aiClient.validatePersonality();
}

async function main() {
  await initDatabase();
  await groupRegistryService.ensureTable();
  await mediaService.ensureTables();
  await meowService.ensureTable();
  logCommentaryStatus();
  await bot.launch();
  console.log('🤖 ربات الینالیزه با موفقیت اجرا شد.');
}

main().catch((err) => {
  console.error('خطای راه‌اندازی ربات:', err);
  process.exit(1);
});

// خاموشی تمیز
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
