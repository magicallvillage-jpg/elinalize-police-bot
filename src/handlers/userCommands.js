// پیاده‌سازی دستورات کاربران عادی: درخواست ثبت گزارش، صبح/شب بخیر، ابراز علاقه،
// پروفایل و "خسته‌ام".
const warningService = require('../services/warningService');
const reportService = require('../services/reportService');
const loveAngerService = require('../services/loveAngerService');
const hopHopService = require('../services/hopHopService');
const insultService = require('../services/insultService');
const { t } = require('../utils/messages');
const { mentionUser, randomIntBetween } = require('../utils/helpers');
const { requireReplyTarget } = require('./rankCommands');
const config = require('../config');

// 1. لیزه اخطار (نسخه کاربر عادی: درخواست تایید از مقام‌دارها)
async function reportRequestCommand(ctx, groupId, reporter) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  const reportId = await reportService.createReport(groupId, reporter.id, target.id);
  await ctx.reply(t('userCommands.reportRequest', { reporter: mentionUser(reporter), target: mentionUser(target) }), {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '✅ تایید', callback_data: `report_approve:${reportId}` },
          { text: '❌ رد', callback_data: `report_reject:${reportId}` },
        ],
      ],
    },
  });
}

// 3. لیزه صبح بخیر (به پیام خود شخص ریپلای می‌زند)
async function goodMorningCommand(ctx) {
  const name = ctx.from.first_name || ctx.from.username || 'دوست من';
  await ctx.reply(t('userCommands.goodMorning', { name }), {
    reply_parameters: { message_id: ctx.message.message_id },
  });
}

// 4. لیزه شب بخیر (به پیام خود شخص ریپلای می‌زند)
async function goodNightCommand(ctx) {
  const name = ctx.from.first_name || ctx.from.username || 'دوست من';
  await ctx.reply(t('userCommands.goodNight', { name }), {
    reply_parameters: { message_id: ctx.message.message_id },
  });
}

// 5. لیزه دوست دارم / لیزه عاشقتم
async function loveCommand(ctx, groupId) {
  const name = ctx.from.first_name || ctx.from.username || 'دوست من';
  const result = await loveAngerService.registerLoveAction(groupId, ctx.from.id);

  if (result.onCooldown) {
    await ctx.reply(t('userCommands.loveCooldown'));
    return;
  }

  await ctx.reply(t('userCommands.loveReplies', { name }));

  if (result.grantedSpecialRank) {
    await handleSpecialRankGrant(ctx, groupId, ctx.from);
  }
}

/** اعطای مقام موقت "عزیز الینالیزه" وقتی علاقه ۱۰۰٪ و عصبانیت ۰٪ شود */
async function handleSpecialRankGrant(ctx, groupId, user) {
  const roleService = require('../services/roleService');
  const cfg = config.loveAnger;

  let rank = await roleService.getRankByName(groupId, cfg.specialRankName);
  if (!rank) {
    // اگر مقام از قبل ساخته نشده بود، به‌صورت خودکار با دسترسی خالی ساخته می‌شود
    rank = await roleService.createRank(groupId, cfg.specialRankName, 1, {}, ctx.from.id);
  }

  const expiresAt = new Date(Date.now() + cfg.specialRankDurationHours * 60 * 60 * 1000);
  await roleService.assignRank(groupId, user.id, rank.id, user.id, expiresAt);
  await loveAngerService.applySpecialRankGrantedEffect(groupId, user.id);

  await ctx.reply(
    t('userCommands.specialRankGranted', {
      target: mentionUser(user),
      rankName: cfg.specialRankName,
      hours: cfg.specialRankDurationHours,
    }),
    { parse_mode: 'HTML' }
  );
}

// 6. لیزه پروفایل
async function profileCommand(ctx, groupId) {
  const name = ctx.from.first_name || ctx.from.username || 'دوست من';
  const state = await loveAngerService.getState(groupId, ctx.from.id);
  const warnCount = await warningService.getWarningCount(groupId, ctx.from.id);

  await ctx.reply(
    `${t('userCommands.profile.title', { name })}\n` +
      `${t('userCommands.profile.love', { love: state.love })}\n` +
      `${t('userCommands.profile.anger', { anger: state.anger })}\n` +
      `${t('userCommands.profile.warnings', { count: warnCount })}`
  );
}

// 7. لیزه خسته‌ام
// رفع باگ: قبلاً فقط can_send_messages ست می‌شد و اگر restrictChatMember به هر دلیلی
// (مثلاً نبود دسترسی «محدود کردن اعضا» برای ربات) خطا می‌داد، خطا بی‌صدا قورت داده می‌شد
// و پیام موفقیت به هر حال ارسال می‌شد؛ یعنی به نظر می‌رسید سکوت داده شده ولی اصلاً اعمال نشده بود.
// الان: تمام فیلدهای دسترسی صریحاً false ست می‌شوند (سکوت کامل و مطمئن)، و پیام موفقیت
// فقط زمانی فرستاده می‌شود که واقعاً API با موفقیت اجرا شده باشد؛ در غیر این صورت خطا اعلام می‌شود.
async function tiredCommand(ctx) {
  const minutes = randomIntBetween(config.tiredMute.minMinutes, config.tiredMute.maxMinutes);
  const untilDate = Math.floor(Date.now() / 1000) + minutes * 60;

  try {
    await ctx.restrictChatMember(ctx.from.id, {
      permissions: {
        can_send_messages: false,
        can_send_audios: false,
        can_send_documents: false,
        can_send_photos: false,
        can_send_videos: false,
        can_send_video_notes: false,
        can_send_voice_notes: false,
        can_send_polls: false,
        can_send_other_messages: false,
        can_add_web_page_previews: false,
        can_change_info: false,
        can_invite_users: false,
        can_pin_messages: false,
      },
      until_date: untilDate,
    });
  } catch (err) {
    console.error('[tiredCommand] خطا در اعمال سکوت:', err.message);
    await ctx.reply(
      'خواستم برم بخوابم ولی نتونستم ساکتت کنم 😅 (احتمالاً دسترسی «محدود کردن اعضا» رو به من ندادی، از تنظیمات ادمین گروه چک کن).'
    );
    return;
  }

  await ctx.reply(t('userCommands.tired.success'));
}

// جدید: لیزه سگتم -> لیزه می‌گوید "برام هاپ هاپ کن"؛ پیام *بعدی* همین کاربر بررسی می‌شود
// (این بررسی در index.js پیش از مسیریابی عادی دستورات انجام می‌شود، چون به پیام بعدی نیاز دارد)
async function dogLoveCommand(ctx, groupId) {
  const result = await hopHopService.startChallenge(groupId, ctx.from.id);
  if (result.onCooldown) {
    await ctx.reply(t('userCommands.hopHop.cooldown'), { reply_parameters: { message_id: ctx.message.message_id } });
    return;
  }
  await ctx.reply(t('userCommands.hopHop.prompt'), { reply_parameters: { message_id: ctx.message.message_id } });
}

/** پردازش پیام بعدی بعد از "لیزه سگتم" - از index.js صدا زده می‌شود */
async function resolveDogLoveChallenge(ctx, groupId) {
  const result = await hopHopService.consumeIfAwaiting(groupId, ctx.from.id, ctx.message.text);
  if (!result.consumed) return false;

  if (result.success) {
    await loveAngerService.applyHopSuccessEffect(groupId, ctx.from.id);
    await ctx.reply(t('userCommands.hopHop.success'), { reply_parameters: { message_id: ctx.message.message_id } });
  } else {
    await loveAngerService.applyHopFailureEffect(groupId, ctx.from.id);
    await ctx.reply(t('userCommands.hopHop.fail'), { reply_parameters: { message_id: ctx.message.message_id } });
  }
  return true;
}

// جدید: لیزه توهین (با ریپلای روی پیام کسی) - شوخی گروهی، برای همه کاربران آزاد است
async function insultCommand(ctx, groupId) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;

  const insult = await insultService.getRandomInsult(groupId);
  if (!insult) {
    await ctx.reply(t('userCommands.insult.noneAvailable'));
    return;
  }
  await ctx.telegram.sendMessage(ctx.chat.id, insult, {
    reply_parameters: { message_id: ctx.message.reply_to_message.message_id },
  });
}

module.exports = {
  reportRequestCommand,
  goodMorningCommand,
  goodNightCommand,
  loveCommand,
  profileCommand,
  tiredCommand,
  handleSpecialRankGrant,
  dogLoveCommand,
  resolveDogLoveChallenge,
  insultCommand,
};
