// هر بار که پیامی از یک گروه می‌رسد، آن گروه را (در صورت جدید بودن) در جدول known_groups
// ثبت می‌کند تا بعداً در پنل پیوی ادمین مادر قابل انتخاب باشد.
const groupRegistryService = require('../services/groupRegistryService');

async function groupRegistryMiddleware(ctx, next) {
  if (ctx.chat && (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup')) {
    groupRegistryService.registerGroup(ctx.chat.id, ctx.chat.title).catch((err) => {
      console.error('[groupRegistryMiddleware] خطا:', err.message);
    });
  }
  return next();
}

module.exports = { groupRegistryMiddleware };
