// دستورات مدیریتی سطح بالا: ساخت مقام، تخصیص/حذف مقام از کاربر، تنظیم کلمات صدا زدن،
// سقف اخطار و متن قوانین. اکثر این عملیات فقط برای ادمین‌های مادر (از env) مجاز است؛
// تخصیص/حذف مقام همچنین برای مقام‌دارانی که دسترسی setRank دارند با رعایت سلسله‌مراتب مجاز است.
const roleService = require('../services/roleService');
const groupSettingsService = require('../services/groupSettingsService');
const activityService = require('../services/activityService');
const insultService = require('../services/insultService');
const { requireReplyTarget, checkHierarchy } = require('./rankCommands');
const { t } = require('../utils/messages');
const { mentionUser } = require('../utils/helpers');

/** "ساخت مقام <نام> <سطح>" - فقط ادمین مادر. دسترسی‌های مقام بعداً از طریق پنل تنظیم می‌شوند. */
async function createRankCommand(ctx, groupId, actor, rest) {
  if (!roleService.isMotherAdmin(actor.id)) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  const parts = rest.trim().split(/\s+/);
  const priority = Number(parts[parts.length - 1]);
  const name = Number.isFinite(priority) ? parts.slice(0, -1).join(' ') : rest.trim();
  const finalPriority = Number.isFinite(priority) ? priority : 1;

  if (!name) {
    await ctx.reply('فرمت درست: «لیزه ساخت مقام <نام مقام> <سطح عددی>» مثلاً: لیزه ساخت مقام پلیس شب 5');
    return;
  }

  const existing = await roleService.getRankByName(groupId, name);
  if (existing) {
    await ctx.reply('مقامی با این نام از قبل وجود داره.');
    return;
  }

  await roleService.createRank(groupId, name, finalPriority, {}, actor.id);
  await ctx.reply(
    `✅ مقام «${name}» با سطح ${finalPriority} ساخته شد. برای تنظیم دسترسی‌هاش از پنل («لیزه پنل») استفاده کن.`
  );
}

/** "تنظیم مقام <نام مقام>" با ریپلای روی کاربر هدف */
async function setRankCommand(ctx, groupId, actor, rankName) {
  const isMother = roleService.isMotherAdmin(actor.id);
  const actorRank = await roleService.getUserRank(groupId, actor.id);
  const canSetRank = isMother || (actorRank && actorRank.permissions.setRank);
  if (!canSetRank) {
    await ctx.reply(t('general.noPermission'));
    return;
  }

  const target = await requireReplyTarget(ctx);
  if (!target) return;

  const rank = await roleService.getRankByName(groupId, rankName.trim());
  if (!rank) {
    await ctx.reply(`مقامی به اسم «${rankName.trim()}» پیدا نشد.`);
    return;
  }

  // بررسی سلسله‌مراتب: کسی نمی‌تواند مقامی هم‌رتبه یا بالاتر از خودش به کسی بدهد (به جز ادمین مادر)
  if (!isMother && actorRank.priority <= rank.priority) {
    await ctx.reply(t('general.rankHierarchyBlock'));
    return;
  }

  await roleService.assignRank(groupId, target.id, rank.id, actor.id);
  await activityService.logActivity({
    groupId,
    actorUserId: actor.id,
    action: 'set_rank',
    targetUserId: target.id,
    details: rank.name,
  });
  await ctx.reply(`✅ مقام «${rank.name}» به ${mentionUser(target)} داده شد.`, { parse_mode: 'HTML' });
}

/** "حذف مقام" با ریپلای روی کاربر هدف */
async function removeRankCommand(ctx, groupId, actor) {
  const isMother = roleService.isMotherAdmin(actor.id);
  const actorRank = await roleService.getUserRank(groupId, actor.id);
  const canSetRank = isMother || (actorRank && actorRank.permissions.setRank);
  if (!canSetRank) {
    await ctx.reply(t('general.noPermission'));
    return;
  }

  const target = await requireReplyTarget(ctx);
  if (!target) return;

  if (!(await checkHierarchy(ctx, groupId, actor.id, target.id))) return;

  await roleService.removeRank(groupId, target.id);
  await activityService.logActivity({ groupId, actorUserId: actor.id, action: 'remove_rank', targetUserId: target.id });
  await ctx.reply(`✅ مقام ${mentionUser(target)} حذف شد.`, { parse_mode: 'HTML' });
}

/** "افزودن صدا زدن <کلمه>" - فقط ادمین مادر */
async function addWakeWordCommand(ctx, groupId, actor, word) {
  if (!roleService.isMotherAdmin(actor.id)) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  if (!word.trim()) {
    await ctx.reply('یک کلمه بعد از دستور بنویس. مثال: لیزه افزودن صدا زدن نازی');
    return;
  }
  await groupSettingsService.addWakeWord(groupId, word.trim());
  await ctx.reply(`✅ از این به بعد با گفتن «${word.trim()}» هم می‌تونید با من صحبت کنید.`);
}

/** "حذف صدا زدن <کلمه>" - فقط ادمین مادر */
async function removeWakeWordCommand(ctx, groupId, actor, word) {
  if (!roleService.isMotherAdmin(actor.id)) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  await groupSettingsService.removeWakeWord(groupId, word.trim());
  await ctx.reply(`✅ کلمه «${word.trim()}» از لیست کلمات صدا زدن حذف شد.`);
}

/** "تنظیم سقف اخطار <عدد>" - فقط ادمین مادر */
async function setWarningLimitCommand(ctx, groupId, actor, rest) {
  if (!roleService.isMotherAdmin(actor.id)) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  const limit = Number(rest.trim());
  if (!Number.isFinite(limit) || limit <= 0) {
    await ctx.reply('یک عدد معتبر بنویس. مثال: لیزه تنظیم سقف اخطار 3');
    return;
  }
  await groupSettingsService.upsertSettings(groupId, { warning_limit: limit });
  await ctx.reply(`✅ سقف اخطار روی ${limit} تنظیم شد.`);
}

/** "تنظیم قوانین <متن>" - فقط ادمین مادر */
async function setRulesCommand(ctx, groupId, actor, rest) {
  if (!roleService.isMotherAdmin(actor.id)) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  if (!rest.trim()) {
    await ctx.reply('متن قوانین رو بعد از دستور بنویس.');
    return;
  }
  await groupSettingsService.upsertSettings(groupId, { rules_text: rest.trim() });
  await ctx.reply('✅ قوانین گروه به‌روزرسانی شد.');
}

/** "تنظیم توهین <متن>" - افزودن یک توهین جدید به لیست شوخی گروهی - فقط ادمین مادر */
async function addInsultCommand(ctx, groupId, actor, rest) {
  if (!roleService.isMotherAdmin(actor.id)) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  const text = rest.trim();
  if (!text) {
    await ctx.reply(t('userCommands.insult.insultTextRequired'));
    return;
  }
  await insultService.addInsult(groupId, text, actor.id);
  await ctx.reply(t('userCommands.insult.insultAdded'));
}

/** "حذف توهین <متن>" - حذف یک توهین سفارشی از لیست - فقط ادمین مادر */
async function removeInsultCommand(ctx, groupId, actor, rest) {
  if (!roleService.isMotherAdmin(actor.id)) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  const text = rest.trim();
  const removed = await insultService.removeInsult(groupId, text);
  await ctx.reply(t(removed ? 'userCommands.insult.insultRemoved' : 'userCommands.insult.insultNotFound'));
}

module.exports = {
  createRankCommand,
  setRankCommand,
  removeRankCommand,
  addWakeWordCommand,
  removeWakeWordCommand,
  setWarningLimitCommand,
  setRulesCommand,
  addInsultCommand,
  removeInsultCommand,
};
