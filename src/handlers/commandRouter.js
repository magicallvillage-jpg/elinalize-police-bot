// این ماژول قلب تشخیص دستورات است: بعد از اینکه wakeWordParser تایید کرد پیام
// با یک کلمه صدا زدن شروع شده، متن باقی‌مانده اینجا با لیست الگوهای شناخته‌شده مقایسه می‌شود
// و در صورت تطبیق، دسترسی لازم بررسی و handler مربوطه اجرا می‌شود.
// نکته: طبق نیازمندی، با ربات فقط با فارسی می‌شود دستور داد؛ اگر هیچ الگویی تطبیق نخورد
// و متن شامل حروف غیرفارسی/غیرمجاز باشد پیامی برای راهنمایی ارسال می‌شود.
const roleService = require('../services/roleService');
const rankCommands = require('./rankCommands');
const userCommands = require('./userCommands');
const adminCommands = require('./adminCommands');
const panelHandlers = require('./panelHandlers');
const meowCommands = require('./meowCommands');
const { t } = require('../utils/messages');

/**
 * هر آیتم: regex روی متن trim شده بعد از کلمه صدا زدن، permission لازم (یا null یعنی بدون نیاز به دسترسی خاص،
 * چون یا برای همه آزاده یا داخل خود handler دسترسی مادر/ست‌رنک چک میشه)، و اجراکننده.
 */
const COMMANDS = [
  // --- دستورات مقام‌دار (نیازمند دسترسی) ---
  { regex: /^اخراج$/, permission: 'kick', handler: (ctx, g, a) => rankCommands.kickCommand(ctx, g, a) },
  { regex: /^حذف اخراج$/, permission: 'unkick', handler: (ctx, g, a) => rankCommands.unkickCommand(ctx, g, a) },
  { regex: /^اسپویلر$/, permission: 'spoiler', handler: (ctx, g, a) => rankCommands.spoilerCommand(ctx, g, a) },
  {
    regex: /^حذف اخطار$/,
    permission: 'removeWarn',
    handler: (ctx, g, a) => rankCommands.removeWarnCommand(ctx, g, a),
  },
  {
    regex: /^حذف پیام$/,
    permission: 'deleteMessage',
    handler: (ctx, g, a) => rankCommands.deleteMessageCommand(ctx, g, a),
  },
  {
    regex: /^گزارش فعالیت$/,
    permission: 'showActivity',
    handler: (ctx, g) => rankCommands.activityReportCommand(ctx, g),
  },
  {
    regex: /^سکوت\s+(\d+)$/,
    permission: 'mute',
    handler: (ctx, g, a, m) => rankCommands.muteCommand(ctx, g, a, Number(m[1])),
  },
  {
    regex: /^لیست زندانی$/,
    permission: 'banList',
    handler: (ctx, g) => rankCommands.prisonListCommand(ctx, g),
  },
  {
    regex: /^لیست مجرمین$/,
    permission: 'criminalList',
    handler: (ctx, g) => rankCommands.criminalListCommand(ctx, g),
  },
  { regex: /^چه خبر$/, permission: 'recentActivity', handler: (ctx, g) => rankCommands.whatsNewCommand(ctx, g) },

  // --- باز برای همه اعضای گروه ---
  { regex: /^قوانین$/, permission: null, handler: (ctx, g) => rankCommands.rulesCommand(ctx, g) },
  { regex: /^نمایش مقام$/, permission: null, handler: (ctx, g) => rankCommands.showRankCommand(ctx, g) },
  { regex: /^صبح بخیر$/, permission: null, handler: (ctx) => userCommands.goodMorningCommand(ctx) },
  { regex: /^شب بخیر$/, permission: null, handler: (ctx) => userCommands.goodNightCommand(ctx) },
  {
    regex: /^(دوست دارم|عاشقتم)$/,
    permission: null,
    handler: (ctx, g) => userCommands.loveCommand(ctx, g),
  },
  { regex: /^پروفایل$/, permission: null, handler: (ctx, g) => userCommands.profileCommand(ctx, g) },
  { regex: /^خسته ام$/, permission: null, handler: (ctx) => userCommands.tiredCommand(ctx) },
  { regex: /^سگتم$/, permission: null, handler: (ctx, g) => userCommands.dogLoveCommand(ctx, g) },
  { regex: /^توهین$/, permission: null, handler: (ctx, g) => userCommands.insultCommand(ctx, g) },
  { regex: /^میو$/, permission: null, handler: (ctx, g) => meowCommands.meowCommand(ctx, g) },

  // --- دستور دوگانه: اخطار (مقام‌دار مستقیم اخطار می‌ده / کاربر عادی درخواست گزارش می‌ده) ---
  {
    regex: /^اخطار$/,
    permission: 'special:warnOrReport',
    handler: async (ctx, g, a) => {
      const canWarn = await roleService.hasPermission(g, a.id, 'warn');
      if (canWarn) return rankCommands.warnCommandDirect(ctx, g, a);
      return userCommands.reportRequestCommand(ctx, g, a);
    },
  },

  // --- دستورات مدیریتی (بررسی دسترسی داخل خود handler انجام می‌شود) ---
  {
    regex: /^ساخت مقام\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.createRankCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^تنظیم مقام\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.setRankCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^حذف مقام$/,
    permission: 'special:admin',
    handler: (ctx, g, a) => adminCommands.removeRankCommand(ctx, g, a),
  },
  {
    regex: /^افزودن صدا زدن\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.addWakeWordCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^حذف صدا زدن\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.removeWakeWordCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^تنظیم سقف اخطار\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.setWarningLimitCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^تنظیم قوانین\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.setRulesCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^تنظیم توهین\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.addInsultCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^حذف توهین\s+(.+)$/,
    permission: 'special:admin',
    handler: (ctx, g, a, m) => adminCommands.removeInsultCommand(ctx, g, a, m[1]),
  },
  {
    regex: /^پنل$/,
    permission: 'special:panel',
    handler: (ctx, g) => panelHandlers.openPanel(ctx, g),
  },
];

/**
 * تلاش برای تطبیق و اجرای یک دستور. برمی‌گرداند true اگر دستوری پیدا و اجرا شد.
 */
async function routeCommand(ctx, groupId, actor, rest) {
  for (const cmd of COMMANDS) {
    const match = rest.match(cmd.regex);
    if (!match) continue;

    // دستورات special خودشان داخل handler دسترسی را چک می‌کنند
    if (cmd.permission && !cmd.permission.startsWith('special:')) {
      const allowed = await roleService.hasPermission(groupId, actor.id, cmd.permission);
      if (!allowed) {
        await ctx.reply(t('general.noPermission'));
        return true;
      }
    }

    await cmd.handler(ctx, groupId, actor, match);
    return true;
  }
  return false;
}

module.exports = { routeCommand, COMMANDS };
