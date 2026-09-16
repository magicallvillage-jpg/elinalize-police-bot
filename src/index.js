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

const roleService = require('./services/roleService');
const groupRegistryService = require('./services/groupRegistryService');
const loveAngerService = require('./services/loveAngerService');
const { t } = require('./utils/messages');

if (!config.botToken) {
  console.error('BOT_TOKEN تنظیم نشده؛ ربات متوقف شد.');
  process.exit(1);
}

const bot = new Telegraf(config.botToken);

// --- میان‌افزارهای عمومی (روی همه آپدیت‌ها اجرا می‌شوند) ---
bot.use(groupRegistryMiddleware);
bot.use(banEnforcementMiddleware);

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

  // پیوی: فقط دستور پنل پشتیبانی می‌شود (برای انتخاب گروه)
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
  if (!matchedWord) return;
  const rest = trimmed.slice(matchedWord.length).trim();

  if (rest === 'پنل') {
    const isMother = roleService.isMotherAdmin(ctx.from.id);
    const groups = await groupRegistryService.listGroupsForPanelAccess(ctx.from.id, isMother);
    if (!groups.length) {
      await ctx.reply('هیچ گروهی که توش دسترسی پنل داشته باشی پیدا نکردم.');
      return;
    }
    const buttons = groups.map((g) => [
      { text: g.title || String(g.group_id), callback_data: `panel_select_group:${g.group_id}` },
    ]);
    await ctx.reply('کدوم گروه رو می‌خوای مدیریت کنی؟', { reply_markup: { inline_keyboard: buttons } });
  }
}

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

async function main() {
  await initDatabase();
  await groupRegistryService.ensureTable();
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
