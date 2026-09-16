// پیاده‌سازی دستورات کاربران عادی: درخواست ثبت گزارش، صبح/شب بخیر، ابراز علاقه،
// پروفایل و "خسته‌ام".
const warningService = require('../services/warningService');
const reportService = require('../services/reportService');
const loveAngerService = require('../services/loveAngerService');
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

// 3. لیزه صبح بخیر
async function goodMorningCommand(ctx) {
  const name = ctx.from.first_name || ctx.from.username || 'دوست من';
  await ctx.reply(t('userCommands.goodMorning', { name }));
}

// 4. لیزه شب بخیر
async function goodNightCommand(ctx) {
  const name = ctx.from.first_name || ctx.from.username || 'دوست من';
  await ctx.reply(t('userCommands.goodNight', { name }));
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
async function tiredCommand(ctx) {
  const minutes = randomIntBetween(config.tiredMute.minMinutes, config.tiredMute.maxMinutes);
  const untilDate = Math.floor(Date.now() / 1000) + minutes * 60;
  try {
    await ctx.restrictChatMember(ctx.from.id, {
      permissions: { can_send_messages: false },
      until_date: untilDate,
    });
  } catch (err) {
    console.error('[tiredCommand] خطا:', err.message);
  }
  await ctx.reply(t('userCommands.tired.success'));
}

module.exports = {
  reportRequestCommand,
  goodMorningCommand,
  goodNightCommand,
  loveCommand,
  profileCommand,
  tiredCommand,
  handleSpecialRankGrant,
};
