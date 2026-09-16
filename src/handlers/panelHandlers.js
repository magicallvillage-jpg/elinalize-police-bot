// پنل مدیریت گرافیکی (دکمه‌های شیشه‌ای) برای ادمین‌های مادر و مقام‌دارانی که panelAccess دارند.
// از این پنل می‌توان: لیست مقام‌ها را دید، سطح دسترسی هر مقام را تیک زد/برداشت،
// و سطح (priority) مقام را برای سلسله‌مراتب تغییر داد.
// طبق نیازمندی، این پنل هم داخل گروه و هم در پیوی ادمین مادر در دسترس است.
const roleService = require('../services/roleService');
const { t } = require('../utils/messages');

const PERMISSION_LABELS = {
  kick: 'اخراج',
  unkick: 'حذف اخراج',
  warn: 'اخطار',
  removeWarn: 'حذف اخطار',
  deleteMessage: 'حذف پیام',
  spoiler: 'اسپویلر',
  mute: 'سکوت',
  showActivity: 'گزارش فعالیت',
  showRank: 'نمایش مقام',
  banList: 'لیست زندانی',
  criminalList: 'لیست مجرمین',
  recentActivity: 'چه خبر',
  setRank: 'تعیین مقام',
  panelAccess: 'دسترسی پنل',
};

async function canOpenPanel(groupId, userId) {
  if (roleService.isMotherAdmin(userId)) return true;
  const rank = await roleService.getUserRank(groupId, userId);
  return Boolean(rank && rank.permissions.panelAccess);
}

/** نمایش صفحه اصلی پنل: لیست مقام‌های گروه */
async function openPanel(ctx, groupId) {
  if (!(await canOpenPanel(groupId, ctx.from.id))) {
    await ctx.reply(t('general.noPermission'));
    return;
  }
  const ranks = await roleService.listRanks(groupId);
  const buttons = ranks.map((r) => [
    { text: `${r.name} (سطح ${r.priority})`, callback_data: `panel_rank:${groupId}:${r.id}` },
  ]);
  buttons.push([{ text: '➕ راهنمای ساخت مقام جدید', callback_data: `panel_help_create:${groupId}` }]);

  await ctx.reply('🛠 پنل مدیریت مقام‌های گروه:', {
    reply_markup: { inline_keyboard: buttons },
  });
}

/** نمایش جزئیات یک مقام با دکمه‌های تیک‌دار برای هر دسترسی */
async function showRankDetail(ctx, groupId, rankId) {
  const rank = await roleService.getRankById(rankId);
  if (!rank) {
    await ctx.answerCbQuery('این مقام دیگه وجود نداره.');
    return;
  }
  const buttons = roleService.PERMISSION_KEYS.map((key) => [
    {
      text: `${rank.permissions[key] ? '✅' : '⬜️'} ${PERMISSION_LABELS[key]}`,
      callback_data: `panel_toggle:${groupId}:${rankId}:${key}`,
    },
  ]);
  buttons.push([
    { text: '🔼 سطح +1', callback_data: `panel_priority:${groupId}:${rankId}:up` },
    { text: '🔽 سطح -1', callback_data: `panel_priority:${groupId}:${rankId}:down` },
  ]);
  buttons.push([{ text: '⬅️ بازگشت', callback_data: `panel_back:${groupId}` }]);

  await ctx.editMessageText(`🪪 مقام: ${rank.name}\nسطح فعلی: ${rank.priority}\n\nدسترسی‌ها را با کلیک روشن/خاموش کن:`, {
    reply_markup: { inline_keyboard: buttons },
  });
}

async function toggleRankPermission(ctx, groupId, rankId, permKey) {
  const rank = await roleService.getRankById(rankId);
  if (!rank) {
    await ctx.answerCbQuery('این مقام دیگه وجود نداره.');
    return;
  }
  const newPerms = { ...rank.permissions, [permKey]: !rank.permissions[permKey] };
  await roleService.updateRankPermissions(groupId, rankId, newPerms);
  await ctx.answerCbQuery('به‌روزرسانی شد.');
  await showRankDetail(ctx, groupId, rankId);
}

async function changeRankPriority(ctx, groupId, rankId, direction) {
  const rank = await roleService.getRankById(rankId);
  if (!rank) {
    await ctx.answerCbQuery('این مقام دیگه وجود نداره.');
    return;
  }
  const delta = direction === 'up' ? 1 : -1;
  const newPriority = Math.max(0, rank.priority + delta);
  await roleService.updateRankPriority(groupId, rankId, newPriority);
  await ctx.answerCbQuery('سطح تغییر کرد.');
  await showRankDetail(ctx, groupId, rankId);
}

async function backToPanelList(ctx, groupId) {
  const ranks = await roleService.listRanks(groupId);
  const buttons = ranks.map((r) => [
    { text: `${r.name} (سطح ${r.priority})`, callback_data: `panel_rank:${groupId}:${r.id}` },
  ]);
  buttons.push([{ text: '➕ راهنمای ساخت مقام جدید', callback_data: `panel_help_create:${groupId}` }]);
  await ctx.editMessageText('🛠 پنل مدیریت مقام‌های گروه:', { reply_markup: { inline_keyboard: buttons } });
}

module.exports = {
  canOpenPanel,
  openPanel,
  showRankDetail,
  toggleRankPermission,
  changeRankPriority,
  backToPanelList,
  PERMISSION_LABELS,
};
