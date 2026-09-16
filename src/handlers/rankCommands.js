// پیاده‌سازی دستورات مقام‌دارها: اخراج، حذف اخراج، قوانین، اسپویلر، اخطار،
// حذف اخطار، حذف پیام، گزارش فعالیت، نمایش مقام، سکوت، لیست زندانی، لیست مجرمین، چه خبر.
const roleService = require('../services/roleService');
const warningService = require('../services/warningService');
const banService = require('../services/banService');
const activityService = require('../services/activityService');
const reportService = require('../services/reportService');
const groupSettingsService = require('../services/groupSettingsService');
const loveAngerService = require('../services/loveAngerService');
const { t } = require('../utils/messages');
const { mentionUser } = require('../utils/helpers');

/** گرفتن کاربر هدف از پیام ریپلای‌شده */
function getReplyTarget(ctx) {
  const reply = ctx.message.reply_to_message;
  if (!reply || !reply.from) return null;
  return reply.from;
}

async function requireReplyTarget(ctx) {
  const target = getReplyTarget(ctx);
  if (!target) {
    await ctx.reply(t('general.needReply'));
    return null;
  }
  return target;
}

/** بررسی اینکه actor روی target طبق سلسله‌مراتب مقام‌ها مجاز به عمل هست یا نه */
async function checkHierarchy(ctx, groupId, actorId, targetId) {
  const actorRank = await roleService.getUserRank(groupId, actorId);
  const targetRank = await roleService.getUserRank(groupId, targetId);
  if (!roleService.canActOnTarget(actorRank, targetRank)) {
    await ctx.reply(t('general.rankHierarchyBlock'));
    return false;
  }
  return true;
}

// 1. لیزه اخراج
async function kickCommand(ctx, groupId, actor) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  if (!(await checkHierarchy(ctx, groupId, actor.id, target.id))) return;

  try {
    await ctx.banChatMember(target.id);
  } catch (err) {
    console.error('[kickCommand] خطا در بن کردن:', err.message);
  }
  await banService.banUser(groupId, target.id, target.username, actor.id);
  await loveAngerService.applyKickEffect(groupId, target.id);
  await activityService.logActivity({
    groupId,
    actorUserId: actor.id,
    action: 'kick',
    targetUserId: target.id,
  });
  await ctx.reply(t('rankCommands.kick.success', { target: mentionUser(target) }), { parse_mode: 'HTML' });
}

// 2. لیزه حذف اخراج
async function unkickCommand(ctx, groupId, actor) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  await banService.unbanUser(groupId, target.id);
  try {
    await ctx.unbanChatMember(target.id, { only_if_banned: true });
  } catch (err) {
    console.error('[unkickCommand] خطا در آنبن کردن:', err.message);
  }
  await activityService.logActivity({
    groupId,
    actorUserId: actor.id,
    action: 'unkick',
    targetUserId: target.id,
  });
  await ctx.reply(t('rankCommands.unkick.success', { target: mentionUser(target) }), { parse_mode: 'HTML' });
}

// 3. الینالیزه قوانین
async function rulesCommand(ctx, groupId) {
  const settings = await groupSettingsService.getSettings(groupId);
  if (!settings.rules_text) {
    await ctx.reply(t('rankCommands.rules.notSet'));
    return;
  }
  await ctx.reply(`📜 قوانین گروه:\n\n${settings.rules_text}`);
}

// 4. لیزه اسپویلر (نسخه ارتقایافته)
// - اگر پیام هدف خودش ریپلای روی پیام دیگری بود، محتوای اسپویلرشده هم روی همون
//   پیام قبلی (پدربزرگ) ریپلای می‌شود تا زنجیره مکالمه حفظ شود.
// - تمام محتوای پیام (چه رسانه چه کپشن/متن) اسپویلر می‌شود.
// - بعد از ارسال، یک گزارش شامل صاحب پیام اصلی و درخواست‌دهنده، روی همان پیام اسپویلرشده ریپلای می‌شود.
async function spoilerCommand(ctx, groupId, actor) {
  const reply = ctx.message.reply_to_message;
  if (!reply) {
    await ctx.reply(t('general.needReply'));
    return;
  }

  // اگر پیام هدف خودش ریپلای روی پیام دیگری بود، همون زنجیره حفظ می‌شود
  const grandParentId = reply.reply_to_message ? reply.reply_to_message.message_id : undefined;
  const replyParams = grandParentId ? { reply_parameters: { message_id: grandParentId } } : {};
  const caption = reply.caption ? `<tg-spoiler>${escapeHtmlLocal(reply.caption)}</tg-spoiler>` : undefined;

  let sentMessage;
  try {
    if (reply.photo) {
      const fileId = reply.photo[reply.photo.length - 1].file_id;
      sentMessage = await ctx.telegram.sendPhoto(ctx.chat.id, fileId, {
        caption,
        parse_mode: caption ? 'HTML' : undefined,
        has_spoiler: true,
        ...replyParams,
      });
    } else if (reply.video) {
      sentMessage = await ctx.telegram.sendVideo(ctx.chat.id, reply.video.file_id, {
        caption,
        parse_mode: caption ? 'HTML' : undefined,
        has_spoiler: true,
        ...replyParams,
      });
    } else if (reply.animation) {
      sentMessage = await ctx.telegram.sendAnimation(ctx.chat.id, reply.animation.file_id, {
        caption,
        parse_mode: caption ? 'HTML' : undefined,
        has_spoiler: true,
        ...replyParams,
      });
    } else if (reply.text) {
      sentMessage = await ctx.telegram.sendMessage(
        ctx.chat.id,
        `<tg-spoiler>${escapeHtmlLocal(reply.text)}</tg-spoiler>`,
        { parse_mode: 'HTML', ...replyParams }
      );
    } else {
      await ctx.reply(t('rankCommands.spoiler.unsupported'));
      return;
    }

    await ctx.deleteMessage(reply.message_id).catch(() => {});
    await ctx.deleteMessage(ctx.message.message_id).catch(() => {});

    // گزارش اسپویلر: صاحب پیام اصلی + درخواست‌دهنده، روی خود پیام اسپویلرشده ریپلای می‌شود
    const reportText = [
      t('rankCommands.spoiler.reportAuthor', { author: mentionUser(reply.from) }),
      t('rankCommands.spoiler.reportRequester', { requester: mentionUser(actor) }),
    ].join('\n');
    await ctx.telegram.sendMessage(ctx.chat.id, reportText, {
      parse_mode: 'HTML',
      reply_parameters: { message_id: sentMessage.message_id },
    });

    await activityService.logActivity({ groupId, actorUserId: actor.id, action: 'spoiler', targetUserId: reply.from?.id });
  } catch (err) {
    console.error('[spoilerCommand] خطا:', err.message);
    await ctx.reply(t('general.actionFailed'));
  }
}

function escapeHtmlLocal(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 5. لیزه اخطار (نسخه مقام‌دار: مستقیم اخطار می‌دهد)
async function warnCommandDirect(ctx, groupId, actor) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  if (!(await checkHierarchy(ctx, groupId, actor.id, target.id))) return;

  const settings = await groupSettingsService.getSettings(groupId);
  const newCount = await warningService.addWarning(groupId, target.id);
  await activityService.logActivity({ groupId, actorUserId: actor.id, action: 'warn', targetUserId: target.id });

  if (newCount >= settings.warning_limit) {
    try {
      await ctx.banChatMember(target.id);
    } catch (err) {
      console.error('[warnCommandDirect] خطا در اخراج خودکار:', err.message);
    }
    await banService.banUser(groupId, target.id, target.username, actor.id);
    await loveAngerService.applyKickEffect(groupId, target.id);
    await warningService.resetWarnings(groupId, target.id);
    await ctx.reply(t('rankCommands.warn.limitReached', { target: mentionUser(target) }), { parse_mode: 'HTML' });
    return;
  }

  await ctx.reply(
    t('rankCommands.warn.success', { target: mentionUser(target), count: newCount, limit: settings.warning_limit }),
    { parse_mode: 'HTML' }
  );
}

// 6. الینالیزه حذف اخطار
async function removeWarnCommand(ctx, groupId, actor) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  const current = await warningService.getWarningCount(groupId, target.id);
  if (current <= 0) {
    await ctx.reply(t('rankCommands.removeWarn.noWarnings'));
    return;
  }
  const newCount = await warningService.removeWarning(groupId, target.id);
  await activityService.logActivity({ groupId, actorUserId: actor.id, action: 'remove_warn', targetUserId: target.id });
  await ctx.reply(t('rankCommands.removeWarn.success', { target: mentionUser(target), count: newCount }), {
    parse_mode: 'HTML',
  });
}

// 7. لیزه حذف پیام
async function deleteMessageCommand(ctx, groupId, actor) {
  const reply = ctx.message.reply_to_message;
  if (!reply) {
    await ctx.reply(t('general.needReply'));
    return;
  }
  try {
    await ctx.deleteMessage(reply.message_id);
    await ctx.deleteMessage(ctx.message.message_id).catch(() => {});
  } catch (err) {
    console.error('[deleteMessageCommand] خطا:', err.message);
    await ctx.reply(t('general.actionFailed'));
    return;
  }
  await activityService.logActivity({ groupId, actorUserId: actor.id, action: 'delete_message', targetUserId: reply.from?.id });
}

// 8. لیزه گزارش فعالیت
async function activityReportCommand(ctx, groupId) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  const activities = await activityService.getUserActivity(groupId, target.id);
  if (!activities.length) {
    await ctx.reply(t('rankCommands.activityReport.empty'));
    return;
  }
  const lines = activities.map((a) => `• ${a.action}${a.details ? ' - ' + a.details : ''} (${formatDate(a.created_at)})`);
  await ctx.reply(
    `${t('rankCommands.activityReport.title', { target: mentionUser(target) })}\n\n${lines.join('\n')}`,
    { parse_mode: 'HTML' }
  );
}

function formatDate(d) {
  try {
    return new Date(d).toLocaleString('fa-IR');
  } catch {
    return String(d);
  }
}

// 9. لیزه نمایش مقام (مشترک بین مقام‌دار و کاربر عادی - بدون نیاز به دسترسی خاص)
async function showRankCommand(ctx, groupId) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  const rank = await roleService.getUserRank(groupId, target.id);
  if (!rank) {
    await ctx.reply(t('rankCommands.showRank.noRank', { target: mentionUser(target) }), { parse_mode: 'HTML' });
    return;
  }
  await ctx.reply(
    `${t('rankCommands.showRank.title', { target: mentionUser(target) })}\n` +
      `${t('rankCommands.showRank.rankLine', { rank: rank.name })}\n` +
      `${t('rankCommands.showRank.priorityLine', { priority: rank.priority })}`,
    { parse_mode: 'HTML' }
  );
}

// 10. لیزه سکوت عدد
async function muteCommand(ctx, groupId, actor, minutes) {
  const target = await requireReplyTarget(ctx);
  if (!target) return;
  if (!(await checkHierarchy(ctx, groupId, actor.id, target.id))) return;

  const untilDate = Math.floor(Date.now() / 1000) + minutes * 60;
  try {
    await ctx.restrictChatMember(target.id, {
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
    console.error('[muteCommand] خطا:', err.message);
    await ctx.reply(t('general.actionFailed'));
    return;
  }
  await activityService.logActivity({
    groupId,
    actorUserId: actor.id,
    action: 'mute',
    targetUserId: target.id,
    details: `${minutes} دقیقه`,
  });
  await ctx.reply(t('rankCommands.mute.success', { target: mentionUser(target), minutes }), { parse_mode: 'HTML' });
}

// 11. الینالیزه لیست زندانی (با صفحه‌بندی)
async function prisonListCommand(ctx, groupId, offset = 0) {
  const items = await banService.listBanned(groupId, offset, 10);
  const total = await banService.countBanned(groupId);
  if (!items.length) {
    await ctx.reply(t('rankCommands.prisonList.empty'));
    return;
  }
  const lines = items.map(
    (u, i) => `${offset + i + 1}. <a href="tg://user?id=${u.user_id}">${u.username || u.user_id}</a>`
  );
  const hasMore = offset + items.length < total;
  const keyboard = hasMore
    ? { inline_keyboard: [[{ text: '➡️ ۱۰ نفر بعدی', callback_data: `prison_list:${offset + 10}` }]] }
    : undefined;
  await ctx.reply(`${t('rankCommands.prisonList.title')}\n\n${lines.join('\n')}`, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

// 12. لیزه لیست مجرمین (با صفحه‌بندی)
async function criminalListCommand(ctx, groupId, offset = 0) {
  const items = await reportService.listApprovedReports(groupId, offset, 10);
  const total = await reportService.countApprovedReports(groupId);
  if (!items.length) {
    await ctx.reply(t('rankCommands.criminalList.empty'));
    return;
  }
  const lines = items.map(
    (r, i) => `${offset + i + 1}. <a href="tg://user?id=${r.target_id}">${r.target_id}</a>`
  );
  const hasMore = offset + items.length < total;
  const keyboard = hasMore
    ? { inline_keyboard: [[{ text: '➡️ ۱۰ نفر بعدی', callback_data: `criminal_list:${offset + 10}` }]] }
    : undefined;
  await ctx.reply(`${t('rankCommands.criminalList.title')}\n\n${lines.join('\n')}`, {
    parse_mode: 'HTML',
    reply_markup: keyboard,
  });
}

// 13. لیزه چه خبر
async function whatsNewCommand(ctx, groupId) {
  const rows = await activityService.getRecentRankActivity(groupId, 24);
  if (!rows.length) {
    await ctx.reply(t('rankCommands.recentActivity.empty'));
    return;
  }
  const lines = rows.map(
    (r) => `• <a href="tg://user?id=${r.actor_user_id}">${r.actor_user_id}</a> — ${r.action_count} عملیات`
  );
  await ctx.reply(`${t('rankCommands.recentActivity.title')}\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
}

module.exports = {
  getReplyTarget,
  requireReplyTarget,
  checkHierarchy,
  kickCommand,
  unkickCommand,
  rulesCommand,
  spoilerCommand,
  warnCommandDirect,
  removeWarnCommand,
  deleteMessageCommand,
  activityReportCommand,
  showRankCommand,
  muteCommand,
  prisonListCommand,
  criminalListCommand,
  whatsNewCommand,
};
