// سرویس مدیریت عکس‌ها و استیکرهایی که ادمین مادر مستقیماً از داخل خود ربات (پیوی) اضافه می‌کند.
//
// چرا دیتابیس و نه نوشتن داخل فایل JSON؟
//   روی هاستینگ‌هایی مثل Railway / Heroku / Docker فایل‌سیستم موقتی است و با هر دیپلوی یا ری‌استارت،
//   تغییرات فایل‌ها از بین می‌رود. دیتابیس MySQL شما دائمی است.
//
// لیست نهایی که قابلیت‌های سرگرمی استفاده می‌کنند =
//   موارد واقعی داخل فایل‌های JSON (اگر قبلاً پر کرده باشید)  +  موارد اضافه‌شده از پنل (دیتابیس)
// یعنی هیچ‌چیز از تنظیمات قبلی‌تان از دست نمی‌رود؛ فقط موارد داخل دیتابیس از پنل قابل حذف‌اند.
const crypto = require('crypto');
const { query } = require('../database/db');
const config = require('../config');
const stickersFile = require('../data/stickers.json');
const photosFile = require('../data/pamPolicePhotos.json');

const P = config.tablePrefix;

/** مقدار خالی یا placeholder هایی مثل PUT_YOUR_..._HERE در فایل‌های JSON نادیده گرفته می‌شوند */
function isRealValue(v) {
  return typeof v === 'string' && v.trim() !== '' && !v.startsWith('PUT_');
}

async function ensureTables() {
  // عکس‌ها (برای شوخی «پام پلیس»): هر ردیف یک عکس. file_unique_id برای جلوگیری از ذخیره‌ی تکراری است.
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}media_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      file_id VARCHAR(255) NOT NULL,
      file_unique_id VARCHAR(64) NOT NULL,
      added_by BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_photo (file_unique_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // بسته‌های استیکر: single = یک استیکر | sequence = چند استیکر پشت‌سرهم و به ترتیب (file_ids یک آرایه JSON است).
  // signature = هش نوع + ترتیب استیکرها، برای جلوگیری از ذخیره‌ی بسته‌ی کاملاً تکراری.
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}media_sticker_packs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      pack_type ENUM('single','sequence') NOT NULL,
      file_ids JSON NOT NULL,
      signature CHAR(64) NOT NULL,
      added_by BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_signature (signature)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

// ===================== عکس‌ها =====================

/** ذخیره یک عکس. برمی‌گرداند true اگر جدید بود و false اگر قبلاً همین عکس ذخیره شده بود. */
async function addPhoto({ fileId, fileUniqueId, addedBy }) {
  const result = await query(
    `INSERT IGNORE INTO ${P}media_photos (file_id, file_unique_id, added_by) VALUES (?, ?, ?)`,
    [fileId, fileUniqueId, addedBy]
  );
  return result.affectedRows > 0;
}

/** عکس‌های ذخیره‌شده در دیتابیس (قدیمی‌ترین اول) */
async function listPhotos() {
  return query(`SELECT * FROM ${P}media_photos ORDER BY id ASC`);
}

async function deletePhoto(id) {
  const result = await query(`DELETE FROM ${P}media_photos WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

// ===================== استیکرها =====================

function makeSignature(type, uniqueIds) {
  return crypto.createHash('sha256').update(`${type}:${uniqueIds.join('|')}`).digest('hex');
}

function parseFileIds(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function deserializePack(row) {
  return { ...row, file_ids: parseFileIds(row.file_ids) };
}

/**
 * ذخیره یک بسته استیکر.
 * type: 'single' (دقیقاً یک استیکر) یا 'sequence' (چند استیکر به ترتیب)
 * parts: [{ fileId, uniqueId }, ...]
 * خروجی: { inserted: boolean, id: number|null }
 */
async function addStickerPack({ type, parts, addedBy }) {
  const fileIds = parts.map((p) => p.fileId);
  const signature = makeSignature(type, parts.map((p) => p.uniqueId));
  const result = await query(
    `INSERT IGNORE INTO ${P}media_sticker_packs (pack_type, file_ids, signature, added_by) VALUES (?, ?, ?, ?)`,
    [type, JSON.stringify(fileIds), signature, addedBy]
  );
  const inserted = result.affectedRows > 0;
  return { inserted, id: inserted ? result.insertId : null };
}

async function listStickerPacks() {
  const rows = await query(`SELECT * FROM ${P}media_sticker_packs ORDER BY id ASC`);
  return rows.map(deserializePack);
}

async function getStickerPack(id) {
  const rows = await query(`SELECT * FROM ${P}media_sticker_packs WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? deserializePack(rows[0]) : null;
}

async function deleteStickerPack(id) {
  const result = await query(`DELETE FROM ${P}media_sticker_packs WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

// ===================== موارد داخل فایل‌های JSON (قدیمی) =====================

function getFilePhotos() {
  return (photosFile.photos || []).filter(isRealValue);
}

function getFilePacks() {
  return (stickersFile.stickerPacks || []).filter(
    (p) => p && Array.isArray(p.fileIds) && p.fileIds.length > 0 && p.fileIds.every(isRealValue)
  );
}

// ===================== خروجی برای قابلیت‌های سرگرمی =====================

/** همه عکس‌های قابل استفاده (فایل JSON + دیتابیس) - آرایه‌ای از file_id یا URL */
async function getUsablePhotos() {
  const db = await listPhotos();
  return [...getFilePhotos(), ...db.map((r) => r.file_id)];
}

/** همه بسته‌های استیکر قابل استفاده (فایل JSON + دیتابیس) - آرایه‌ای از { type, fileIds } */
async function getUsableStickerPacks() {
  const db = await listStickerPacks();
  const fromDb = db
    .filter((r) => r.file_ids.length > 0)
    .map((r) => ({ type: r.pack_type, fileIds: r.file_ids }));
  return [...getFilePacks(), ...fromDb];
}

/** آمار برای نمایش در منوی پنل */
async function getCounts() {
  const photoRows = await query(`SELECT COUNT(*) AS c FROM ${P}media_photos`);
  const packRows = await query(`SELECT pack_type, COUNT(*) AS c FROM ${P}media_sticker_packs GROUP BY pack_type`);
  const byType = Object.fromEntries(packRows.map((r) => [r.pack_type, Number(r.c)]));
  return {
    photosDb: Number(photoRows[0].c),
    photosFile: getFilePhotos().length,
    singleDb: byType.single || 0,
    sequenceDb: byType.sequence || 0,
    packsFile: getFilePacks().length,
  };
}

module.exports = {
  ensureTables,
  addPhoto,
  listPhotos,
  deletePhoto,
  addStickerPack,
  listStickerPacks,
  getStickerPack,
  deleteStickerPack,
  getUsablePhotos,
  getUsableStickerPacks,
  getCounts,
};
