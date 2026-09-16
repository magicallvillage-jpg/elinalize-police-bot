// وقتی از پنل دکمه‌ای مثل "تغییر نام مقام" زده می‌شود که نیاز به تایپ متن دارد،
// یک پیام force-reply برای ادمین فرستاده می‌شود و شناسه آن پیام در این Map (حافظه‌ای) ذخیره می‌شود.
// وقتی ادمین روی همان پیام ریپلای کند، از این Map اکشن مربوطه پیدا و اجرا می‌شود.
// این حافظه فقط در RAM است و با ری‌استارت ربات پاک می‌شود؛ چون این جریان کوتاه‌مدت (چند ثانیه/دقیقه) است، مشکلی ایجاد نمی‌کند.
const pending = new Map();
const TTL_MS = 10 * 60 * 1000; // ۱۰ دقیقه

function setPendingAction(messageId, action) {
  pending.set(messageId, action);
  setTimeout(() => pending.delete(messageId), TTL_MS).unref?.();
}

function getPendingAction(messageId) {
  return pending.get(messageId);
}

function clearPendingAction(messageId) {
  pending.delete(messageId);
}

module.exports = { setPendingAction, getPendingAction, clearPendingAction };
