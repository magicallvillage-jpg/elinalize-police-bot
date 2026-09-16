// طبق نیازمندی: اگر کاربر اخراج‌شده تحت هر شرایطی دوباره به گروه برگردد
// (مثلاً توسط خود گروه بدون استفاده از دستور "حذف اخراج" ربات)، تمام پیام‌های جدیدش
// باید بلافاصله پس از ارسال حذف شوند. این میان‌افزار روی همه پیام‌های گروه اجرا می‌شود.
const banService = require('../services/banService');

async function banEnforcementMiddleware(ctx, next) {
  if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') && ctx.from) {
    try {
      const banned = await banService.isBanned(ctx.chat.id, ctx.from.id);
      if (banned) {
        await ctx.deleteMessage().catch(() => {});
        // تلاش برای اخراج مجدد؛ اگر ربات دسترسی کافی نداشته باشد بی‌صدا رد می‌شود
        await ctx.banChatMember(ctx.from.id).catch(() => {});
        return; // زنجیره میان‌افزار را متوقف می‌کنیم، پیام کاربر مسدود پردازش نمی‌شود
      }
    } catch (err) {
      console.error('[banEnforcementMiddleware] خطا:', err.message);
    }
  }
  return next();
}

module.exports = { banEnforcementMiddleware };
