// این سرویس درخواست‌های chat completion به OpenRouter می‌زند و برای دو کار استفاده می‌شود:
//  ۱) generateChannelComment: ساخت کامنت کوتاه برای پست‌های کانال
//  ۲) generateChatReply: گفت‌وگوی مستقیم (بخش «تست صحبت با الینالیزه» در پنل پیوی ادمین مادر)
//
// نکته‌های مهم این نسخه:
//  - systemPrompt در personality.json باید «متن» باشد. (نسخه‌ی قبلی یک آبجکت می‌فرستاد و OpenRouter خطا می‌داد.)
//  - OPENROUTER_MODEL در .env می‌تواند یک مدل یا چند مدل جداشده با کاما باشد؛ اگر مدلی وجود نداشت
//    (۴۰۴) یا پر بود (۴۲۹) خودکار سراغ مدل بعدی می‌رود. در آخر هم از openrouter/free استفاده می‌شود.
//  - مدل‌های رایگان OpenRouter مدام عوض می‌شوند؛ اگر مدلی حذف شد لازم نیست کد را عوض کنید.
// از fetch داخلی Node.js (نسخه ۱۸ به بعد) استفاده شده، پس نیازی به پکیج اضافه نیست.
const config = require('../config');
const personality = require('../data/personality.json');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const FALLBACK_MODEL = 'openrouter/free';
const REQUEST_TIMEOUT_MS = 40 * 1000;
const MAX_HISTORY_MESSAGES = 16;

// مدل‌هایی که OpenRouter برایشان ۴۰۴ داده (وجود ندارند) تا ری‌استارت بعدی دوباره امتحان نمی‌شوند
const deadModels = new Set();

/** بررسی می‌کند systemPrompt واقعاً یک متن باشد */
function validatePersonality() {
  if (typeof personality.systemPrompt !== 'string' || !personality.systemPrompt.trim()) {
    console.error(
      '[aiClient] ❌ فیلد systemPrompt داخل src/data/personality.json باید یک «متن» باشد (نه آبجکت). فایل جدید personality.json را جایگزین کنید.'
    );
    return false;
  }
  return true;
}

function buildSystemPrompt(extra) {
  const base = typeof personality.systemPrompt === 'string' ? personality.systemPrompt.trim() : '';
  const add = typeof extra === 'string' ? extra.trim() : '';
  return [base, add].filter(Boolean).join('\n\n');
}

function getModelList() {
  const list = String(config.channelCommentary.openRouterModel || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.includes(FALLBACK_MODEL)) list.push(FALLBACK_MODEL);
  return list;
}

function extractText(data) {
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  let text = '';
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    text = content.map((p) => (typeof p === 'string' ? p : (p && p.text) || '')).join('');
  }
  // بعضی مدل‌های استدلالی افکارشان را داخل <think> می‌نویسند؛ به کاربر نشان داده نمی‌شود
  return text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/** پاک‌سازی خروجی مدل: حذف «الینالیزه:» اول جمله، گیومه‌های دور متن و محدود کردن طول */
function cleanReply(text, maxLen) {
  let out = String(text || '').trim();
  out = out.replace(/^(الینالیزه|لیزه|Elinalise)\s*[:：]\s*/i, '');
  out = out.replace(/^["«“]+/, '').replace(/["»”]+$/, '').trim();
  if (out.length > maxLen) out = `${out.slice(0, maxLen - 1).trimEnd()}…`;
  return out;
}

/**
 * درخواست به OpenRouter با امتحان مدل‌ها به ترتیب.
 * خروجی: { text, model, error } — اگر موفق نشود text=null و error شامل دلیل دقیق است.
 */
async function callOpenRouter(messages, { maxTokens, temperature }) {
  const apiKey = config.channelCommentary.openRouterApiKey;
  if (!apiKey) {
    return { text: null, model: null, error: 'OPENROUTER_API_KEY در فایل .env تنظیم نشده.' };
  }
  if (!validatePersonality()) {
    return { text: null, model: null, error: 'فیلد systemPrompt در personality.json معتبر نیست (باید متن باشد).' };
  }

  const all = getModelList();
  let candidates = all.filter((m) => !deadModels.has(m));
  if (!candidates.length) {
    deadModels.clear();
    candidates = all;
  }

  const errors = [];
  for (const model of candidates) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
        signal: controller.signal,
      });

      // eslint-disable-next-line no-await-in-loop
      const raw = await response.text();
      let data = null;
      try {
        data = JSON.parse(raw);
      } catch (_) {
        /* پاسخ JSON نبود */
      }

      // OpenRouter گاهی خطای provider را با status=200 و فیلد error برمی‌گرداند
      if (!response.ok || (data && data.error)) {
        const detail =
          (data && data.error && (data.error.message || JSON.stringify(data.error))) || raw.slice(0, 200);
        errors.push(`${model} → ${response.status}: ${String(detail).slice(0, 250)}`);
        if (response.status === 404) deadModels.add(model);
        if (response.status === 401) break; // کلید API اشتباه است؛ امتحان مدل‌های دیگر بی‌فایده است
        continue;
      }

      const text = extractText(data);
      if (!text) {
        errors.push(`${model} → پاسخ خالی`);
        continue;
      }
      return { text, model, error: null };
    } catch (err) {
      errors.push(`${model} → ${err.name === 'AbortError' ? 'timeout (پاسخ نیامد)' : err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  const error = errors.join('\n') || 'نامشخص';
  console.error(`[aiClient] همه‌ی مدل‌ها ناموفق بودند:\n${error}`);
  return { text: null, model: null, error };
}

/**
 * تولید یک کامنت کوتاه فارسی برای متن یک پست کانال.
 * در صورت هر مشکلی null برمی‌گرداند (دلیل در لاگ سرور چاپ می‌شود).
 */
async function generateChannelComment(postText) {
  const clean = postText && postText.trim() ? postText.trim().slice(0, 3000) : '';
  const userContent = clean || '(این پست فقط رسانه بود و متنی نداشت)';

  const messages = [
    { role: 'system', content: buildSystemPrompt(personality.commentInstructions) },
    {
      role: 'user',
      content: `متن پست جدید کانال:\n"""\n${userContent}\n"""\n\nیک کامنت کوتاه فارسی زیرش بنویس.`,
    },
  ];

  const { text, model, error } = await callOpenRouter(messages, { maxTokens: 220, temperature: 0.75 });
  if (!text) {
    console.error('[aiClient] ساخت کامنت ناموفق بود:', error);
    return null;
  }
  console.log(`[aiClient] کامنت با مدل ${model} ساخته شد.`);
  return cleanReply(text, 600) || null;
}

/**
 * پاسخ به یک گفت‌وگوی مستقیم. history آرایه‌ای از { role: 'user'|'assistant', content } است.
 * خروجی: { text, model, error }
 */
async function generateChatReply(history) {
  const trimmed = (history || []).slice(-MAX_HISTORY_MESSAGES);
  const messages = [{ role: 'system', content: buildSystemPrompt(personality.chatInstructions) }, ...trimmed];

  const result = await callOpenRouter(messages, { maxTokens: 500, temperature: 0.8 });
  if (!result.text) return result;
  return { ...result, text: cleanReply(result.text, 3500) };
}

module.exports = { generateChannelComment, generateChatReply, validatePersonality };
