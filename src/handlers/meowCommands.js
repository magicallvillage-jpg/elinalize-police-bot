// دستور "لیزه میو" - نسخه گربه‌ای «لیزه سگتم»:
// لیزه می‌گوید "برام میو میو کن"؛ پیام *بعدی* همین کاربر بررسی می‌شود
// (این بررسی در index.js پیش از مسیریابی عادی دستورات انجام می‌شود، چون به پیام بعدی نیاز دارد).
// پاسخ درست: ۵٪+ علاقه | پاسخ غلط: ۱۰٪- علاقه | کول‌داون: هر ۱ ساعت برای هر کاربر
const meowService = require('../services/meowService');
const loveAngerService = require('../services/loveAngerService');
const { t } = require('../utils/messages');

const LOVE_ON_SUCCESS = 5;
const LOVE_ON_FAIL = -10;

/** شروع چالش: "لیزه میو" */
async function meowCommand(ctx, groupId) {
  const result = await meowService.startChallenge(groupId, ctx.from.id);
  if (result.onCooldown) {
    await ctx.reply(t('userCommands.meow.cooldown'), { reply_parameters: { message_id: ctx.message.message_id } });
    return;
  }
  await ctx.reply(t('userCommands.meow.prompt'), { reply_parameters: { message_id: ctx.message.message_id } });
}

/** پردازش پیام بعدی بعد از "لیزه میو" - از index.js صدا زده می‌شود. برمی‌گرداند true اگر پیام مصرف شد. */
async function resolveMeowChallenge(ctx, groupId) {
  const result = await meowService.consumeIfAwaiting(groupId, ctx.from.id, ctx.message.text);
  if (!result.consumed) return false;

  if (result.success) {
    await loveAngerService.applyLoveDelta(groupId, ctx.from.id, LOVE_ON_SUCCESS);
    await ctx.reply(t('userCommands.meow.success'), { reply_parameters: { message_id: ctx.message.message_id } });
  } else {
    await loveAngerService.applyLoveDelta(groupId, ctx.from.id, LOVE_ON_FAIL);
    await ctx.reply(t('userCommands.meow.fail'), { reply_parameters: { message_id: ctx.message.message_id } });
  }
  return true;
}

module.exports = { meowCommand, resolveMeowChallenge };
