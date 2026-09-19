// این سرویس درخواست‌های ساده chat completion به OpenRouter (ai.openrouter) می‌زند
// تا برای پست‌های کانال، با توجه به شخصیت تعریف‌شده در personality.json، یک کامنت کوتاه بسازد.
// از fetch داخلی Node.js (نسخه ۱۸ به بعد) استفاده شده، پس نیازی به پکیج اضافه نیست.
const config = require('../config');
const personality = require('../data/personality.json');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * تولید یک کامنت کوتاه فارسی برای متن یک پست کانال.
 * در صورت هر مشکلی (نبود کلید API، خطای شبکه، پاسخ خالی) مقدار null برمی‌گرداند
 * تا فراخواننده بتواند بی‌سروصدا رد شود، بدون اینکه کل ربات کرش کند.
 */
async function generateChannelComment(postText) {
  if (!config.channelCommentary.openRouterApiKey) {
    console.error('[aiClient] OPENROUTER_API_KEY تنظیم نشده؛ کامنت‌گذاری هوش مصنوعی رد می‌شود.');
    return null;
  }

  const userContent = postText && postText.trim() ? postText.trim() : '(این پست فقط رسانه بود و متنی نداشت)';

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.channelCommentary.openRouterApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.channelCommentary.openRouterModel,
        messages: [
          { role: 'system', content: personality.systemPrompt },
          { role: 'user', content: `این متن پست جدید کانال است، طبق شخصیتت روش کامنت بذار:\n\n${userContent}` },
        ],
        max_tokens: 200,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      console.error(`[aiClient] خطای OpenRouter (${response.status}):`, errText.slice(0, 300));
      return null;
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    console.error('[aiClient] خطا در تماس با OpenRouter:', err.message);
    return null;
  }
}

module.exports = { generateChannelComment };
