// پنل مدیریت گرافیکی (دکمه‌های شیشه‌ای) برای ادمین‌های مادر و مقام‌دارانی که panelAccess دارند.
// از این پنل می‌توان: لیست مقام‌ها را دید، سطح دسترسی هر مقام را تیک زد/برداشت،
// و سطح (priority) مقام را برای سلسله‌مراتب تغییر داد.
// طبق نیازمندی، این پنل دیگر از داخل خود گروه باز نمی‌شود؛ فقط از پیوی ربات (بعد از انتخاب
// گروه از بخش «مدیریت مقام‌ها») در دسترس است. ctx در این حالت متعلق به چت خصوصی ادمین است،
// نه گروه، و groupId جداگانه پاس داده می‌شود.
const roleService = require('../services/roleService');
const { t } = require('../utils/messages');
const { setPendingAction, getPendingAction, clearPendingAction } = require('../utils/pendingActions');

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
  renameRank: 'تغییر نام مقام‌ها',
  panelAccess: 'دسترسی پنل',
};

async function canOpenPanel(groupId, userId) {
  if (roleService.isMotherAdmin(userId)) return true;
  const rank = await roleService.getUserRank(groupId, userId);
  return Boolean(rank && rank.permissions.panelAccess);
}

/** قابلیت جدید: آیا این کاربر اجازه تغییر نام مقام‌ها را دارد؟ (ادمین مادر یا دارنده دسترسی renameRank) */
async function canRenameRank(groupId, userId) {
  if (roleService.isMotherAdmin(userId)) return true;
  const rank = await roleService.getUserRank(groupId, userId);
  return Boolean(rank && rank.permissions.renameRank);
}

/** نمایش صفحه اصلی پنل: لیست مقام‌های گروه (فقط از پیوی صدا زده می‌شود) */
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
  buttons.push([{ text: '⬅️ بازگشت به اطلاعات گروه', callback_data: `panel_select_group:${groupId}` }]);

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
  buttons.push([{ text: '✏️ تغییر نام مقام', callback_data: `panel_rename_prompt:${groupId}:${rankId}` }]);
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

/** شروع فلو تغییر نام: یک پیام force-reply می‌فرستد و شناسه‌اش را برای پردازش پاسخ ذخیره می‌کند */
async function promptRenameRank(ctx, groupId, rankId) {
  if (!(await canRenameRank(groupId, ctx.from.id))) {
    await ctx.answerCbQuery(t('general.noPermission'), { show_alert: true });
    return;
  }
  const rank = await roleService.getRankById(rankId);
  if (!rank) {
    await ctx.answerCbQuery('این مقام دیگه وجود نداره.');
    return;
  }
  await ctx.answerCbQuery();
  const sent = await ctx.reply(t('rankCommands.renameRank.prompt', { current: rank.name }), {
    reply_markup: { force_reply: true, selective: true },
  });
  setPendingAction(sent.message_id, { type: 'rename_rank', groupId, rankId, requesterId: ctx.from.id });
}

/**
 * اجرا می‌شود وقتی کاربر روی پیام force-reply بالا پاسخ می‌دهد.
 * برمی‌گرداند true اگر این پیام واقعاً پاسخ یک اکشن در انتظار بود (تا پردازش عادی پیام متوقف شود).
 */
async function handleRenamePendingReply(ctx) {
  const reply = ctx.message.reply_to_message;
  if (!reply) return false;
  const action = getPendingAction(reply.message_id);
  if (!action || action.type !== 'rename_rank') return false;

  clearPendingAction(reply.message_id);

  if (ctx.from.id !== action.requesterId) return false; // فقط خود درخواست‌دهنده می‌تواند پاسخ بدهد

  const newName = (ctx.message.text || '').trim();
  const rank = await roleService.getRankById(action.rankId);
  if (!rank) {
    await ctx.reply(t('rankCommands.renameRank.expired'));
    return true;
  }
  if (!newName) {
    await ctx.reply(t('rankCommands.renameRank.expired'));
    return true;
  }

  try {
    const oldName = rank.name;
    await roleService.renameRank(action.groupId, action.rankId, newName);
    await ctx.reply(t('rankCommands.renameRank.success', { oldName, newName }));
  } catch (err) {
    if (err.message === 'DUPLICATE_NAME') {
      await ctx.reply(t('rankCommands.renameRank.duplicate'));
    } else {
      console.error('[handleRenamePendingReply] خطا:', err.message);
      await ctx.reply(t('general.actionFailed'));
    }
  }
  return true;
}

async function backToPanelList(ctx, groupId) {
  const ranks = await roleService.listRanks(groupId);
  const buttons = ranks.map((r) => [
    { text: `${r.name} (سطح ${r.priority})`, callback_data: `panel_rank:${groupId}:${r.id}` },
  ]);
  buttons.push([{ text: '➕ راهنمای ساخت مقام جدید', callback_data: `panel_help_create:${groupId}` }]);
  buttons.push([{ text: '⬅️ بازگشت به اطلاعات گروه', callback_data: `panel_select_group:${groupId}` }]);
  await ctx.editMessageText('🛠 پنل مدیریت مقام‌های گروه:', { reply_markup: { inline_keyboard: buttons } });
}

module.exports = {
  canOpenPanel,
  canRenameRank,
  openPanel,
  showRankDetail,
  toggleRankPermission,
  changeRankPriority,
  promptRenameRank,
  handleRenamePendingReply,
  backToPanelList,
  PERMISSION_LABELS,
};
