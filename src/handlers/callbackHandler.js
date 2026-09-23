// این ماژول تمام callback_query های دکمه‌های شیشه‌ای ربات را مسیریابی می‌کند:
// تایید/رد گزارش کاربران عادی، صفحه‌بندی لیست زندانی/مجرمین، پنل مدیریت مقام‌ها،
// و پنل مدیریت تبلیغات.
const reportService = require('../services/reportService');
const roleService = require('../services/roleService');
const loveAngerService = require('../services/loveAngerService');
const activityService = require('../services/activityService');
const rankCommands = require('./rankCommands');
const panelHandlers = require('./panelHandlers');
const funFeatures = require('./funFeatures');
const mediaPanelHandlers = require('./mediaPanelHandlers');
const chatTestHandlers = require('./chatTestHandlers');
const adPanelHandlers = require('./adPanelHandlers');
const { t } = require('../utils/messages');

async function handleCallbackQuery(ctx) {
  const data = ctx.callbackQuery.data || '';
  const [action, ...args] = data.split(':');
  const groupId = ctx.chat ? ctx.chat.id : null;

  try {
    if (action.startsWith('chat_')) {
      await chatTestHandlers.handleCallback(ctx, action);
      return;
    }
    // پنل مدیریت عکس/استیکر (فقط ادمین مادر در پیوی؛ بررسی دسترسی داخل خود ماژول انجام می‌شود)
    if (action.startsWith('media_')) {
      await mediaPanelHandlers.handleCallback(ctx, action, args);
      return;
    }
    // پنل مدیریت تبلیغات (فقط ادمین مادر در پیوی؛ بررسی دسترسی داخل خود ماژول انجام می‌شود)
    if (action.startsWith('ad_')) {
      await adPanelHandlers.handleCallback(ctx, action, args);
      return;
    }

    switch (action) {
      case 'report_approve':
        await handleReportDecision(ctx, Number(args[0]), 'approved');
        break;
      case 'report_reject':
        await handleReportDecision(ctx, Number(args[0]), 'rejected');
        break;
      case 'prison_list':
        await ctx.answerCbQuery();
        await rankCommands.prisonListCommand(ctx, groupId, Number(args[0]));
        break;
      case 'criminal_list':
        await ctx.answerCbQuery();
        await rankCommands.criminalListCommand(ctx, groupId, Number(args[0]));
        break;
      case 'rank_mgmt_root':
        await ctx.answerCbQuery();
        await mediaPanelHandlers.showRankManagementGroups(ctx);
        break;
      case 'panel_rank_group':
        await ctx.answerCbQuery();
        await panelHandlers.openPanel(ctx, Number(args[0]));
        break;
      case 'panel_rank':
        await ctx.answerCbQuery();
        await panelHandlers.showRankDetail(ctx, Number(args[0]), Number(args[1]));
        break;
      case 'panel_toggle':
        await panelHandlers.toggleRankPermission(ctx, Number(args[0]), Number(args[1]), args[2]);
        break;
      case 'panel_priority':
        await panelHandlers.changeRankPriority(ctx, Number(args[0]), Number(args[1]), args[2]);
        break;
      case 'panel_back':
        await ctx.answerCbQuery();
        await panelHandlers.backToPanelList(ctx, Number(args[0]));
        break;
      case 'panel_rename_prompt':
        await panelHandlers.promptRenameRank(ctx, Number(args[0]), Number(args[1]));
        break;
      case 'pam_lick':
        await funFeatures.handlePamLick(ctx, Number(args[0]), Number(args[1]));
        break;
      case 'panel_help_create':
        await ctx.answerCbQuery();
        await ctx.reply(
          'برای ساخت مقام جدید در گروه بنویس:\n«لیزه ساخت مقام <نام مقام> <سطح عددی>»\nمثال: لیزه ساخت مقام پلیس شب 5\nبعد از ساخت، از همین پنل دسترسی‌هاش رو تنظیم کن.'
        );
        break;
      default:
        await ctx.answerCbQuery();
    }
  } catch (err) {
    console.error('[callbackHandler] خطا:', err.message);
    try {
      await ctx.answerCbQuery('مشکلی پیش اومد.');
    } catch (_) {
      /* ignore */
    }
  }
}

/** تایید یا رد یک گزارش توسط مقام‌دار، فقط اگر actor دسترسی warn داشته باشد */
async function handleReportDecision(ctx, reportId, decision) {
  const groupId = ctx.chat.id;
  const actor = ctx.from;

  const hasPerm = await roleService.hasPermission(groupId, actor.id, 'warn');
  if (!hasPerm) {
    await ctx.answerCbQuery(t('general.noPermission'), { show_alert: true });
    return;
  }

  const report = await reportService.getReport(reportId);
  if (!report || report.status !== 'pending') {
    await ctx.answerCbQuery('این گزارش قبلاً بررسی شده.');
    return;
  }

  await reportService.resolveReport(reportId, decision, actor.id);
  await ctx.answerCbQuery(decision === 'approved' ? 'تایید شد.' : 'رد شد.');

  if (decision === 'approved') {
    await loveAngerService.applyReportApprovedEffect(groupId, report.target_id);
    await activityService.logActivity({
      groupId,
      actorUserId: actor.id,
      action: 'report_approved',
      targetUserId: report.target_id,
    });
    await ctx.editMessageText(t('userCommands.reportApproved'));
  } else {
    await ctx.editMessageText(t('userCommands.reportRejected'));
  }
}

module.exports = { handleCallbackQuery };
