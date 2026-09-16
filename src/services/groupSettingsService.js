// سرویس تنظیمات هر گروه: کلمات صدا زدن ("لیزه"/"الینالیزه" و موارد قابل اضافه شدن)،
// سقف اخطار قبل از اخراج خودکار، و متن قوانین گروه.
const { query } = require('../database/db');
const config = require('../config');

const P = config.tablePrefix;

async function getSettings(groupId) {
  const rows = await query(`SELECT * FROM ${P}group_settings WHERE group_id = ? LIMIT 1`, [groupId]);
  if (!rows[0]) {
    return {
      group_id: groupId,
      wake_words: config.defaultWakeWords,
      warning_limit: config.defaultWarningLimit,
      rules_text: null,
    };
  }
  const row = rows[0];
  return {
    ...row,
    wake_words:
      row.wake_words && (typeof row.wake_words === 'string' ? JSON.parse(row.wake_words) : row.wake_words)
        ? typeof row.wake_words === 'string'
          ? JSON.parse(row.wake_words)
          : row.wake_words
        : config.defaultWakeWords,
  };
}

async function upsertSettings(groupId, partial) {
  const current = await getSettings(groupId);
  const merged = {
    wake_words: partial.wake_words !== undefined ? partial.wake_words : current.wake_words,
    warning_limit: partial.warning_limit !== undefined ? partial.warning_limit : current.warning_limit,
    rules_text: partial.rules_text !== undefined ? partial.rules_text : current.rules_text,
  };
  await query(
    `INSERT INTO ${P}group_settings (group_id, wake_words, warning_limit, rules_text)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE wake_words = VALUES(wake_words), warning_limit = VALUES(warning_limit), rules_text = VALUES(rules_text)`,
    [groupId, JSON.stringify(merged.wake_words), merged.warning_limit, merged.rules_text]
  );
  return getSettings(groupId);
}

/** اضافه کردن یک کلمه صدا زدن جدید بدون حذف بقیه */
async function addWakeWord(groupId, word) {
  const settings = await getSettings(groupId);
  const words = new Set(settings.wake_words);
  words.add(word.trim());
  return upsertSettings(groupId, { wake_words: Array.from(words) });
}

async function removeWakeWord(groupId, word) {
  const settings = await getSettings(groupId);
  const words = settings.wake_words.filter((w) => w !== word.trim());
  return upsertSettings(groupId, { wake_words: words });
}

module.exports = { getSettings, upsertSettings, addWakeWord, removeWakeWord };
