// این فایل مسئول ساخت خودکار جداول ربات الینالیزه است.
// چون این دیتابیس بین این ربات و ربات دیگر شما مشترک است،
// تمام جداول با پیشوند `elinalize_` ساخته می‌شوند تا هیچ تداخلی با جداول دیگر پیش نیاید،
// و ساخت جداول با IF NOT EXISTS انجام می‌شود تا اجرای مجدد ربات خطا ندهد.
const { query } = require('./db');
const config = require('../config');

const P = config.tablePrefix;

async function initDatabase() {
  // جدول مقام‌ها (Ranks) - هر گروه مقام‌های مستقل خودش را دارد
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}ranks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      name VARCHAR(100) NOT NULL,
      priority INT NOT NULL DEFAULT 1,
      permissions JSON NOT NULL,
      is_temporary BOOLEAN NOT NULL DEFAULT FALSE,
      created_by BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_group_name (group_id, name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // اختصاص مقام به کاربران؛ expires_at برای مقام‌های موقت مثل "عزیز الینالیزه"
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}user_ranks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      rank_id INT NOT NULL,
      granted_by BIGINT NOT NULL,
      granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NULL DEFAULT NULL,
      KEY idx_group_user (group_id, user_id),
      CONSTRAINT fk_user_ranks_rank FOREIGN KEY (rank_id) REFERENCES ${P}ranks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // اخطارها
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}warnings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_group_user (group_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // کاربران اخراج‌شده (زندانی‌ها) - در صورت بازگشت پیام‌هایشان حذف می‌شود
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}banned_users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      username VARCHAR(255) DEFAULT NULL,
      banned_by BIGINT NOT NULL,
      banned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE KEY uniq_group_user (group_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // سیستم علاقه‌مندی / عصبانیت الینالیزه نسبت به هر کاربر
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}love_anger (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      love INT NOT NULL DEFAULT 0,
      anger INT NOT NULL DEFAULT 0,
      last_love_at TIMESTAMP NULL DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_group_user (group_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // گزارش فعالیت مقام‌ها و کاربران، برای دستورات "گزارش فعالیت" و "چه خبر"
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}activity_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      actor_user_id BIGINT NOT NULL,
      rank_id INT DEFAULT NULL,
      action VARCHAR(64) NOT NULL,
      target_user_id BIGINT DEFAULT NULL,
      details TEXT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_group_time (group_id, created_at),
      KEY idx_group_target (group_id, target_user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // گزارش‌های ثبت‌شده توسط کاربران عادی که منتظر تایید مقام‌دار هستند (لیست مجرمین)
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      reporter_id BIGINT NOT NULL,
      target_id BIGINT NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      resolved_by BIGINT DEFAULT NULL,
      resolved_at TIMESTAMP NULL DEFAULT NULL,
      KEY idx_group_status (group_id, status),
      KEY idx_group_target (group_id, target_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // تنظیمات هر گروه: کلمات صدا زدن، سقف اخطار، متن قوانین و ...
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}group_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL UNIQUE,
      wake_words JSON DEFAULT NULL,
      warning_limit INT NOT NULL DEFAULT 3,
      rules_text TEXT DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // وضعیت چالش "لیزه سگتم" -> "هاپ هاپ": نگهداری اینکه آیا منتظر پاسخ کاربر هستیم و کول‌داون هر ۱ ساعت
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}hop_state (
      group_id BIGINT NOT NULL,
      user_id BIGINT NOT NULL,
      awaiting BOOLEAN NOT NULL DEFAULT FALSE,
      prompted_at TIMESTAMP NULL DEFAULT NULL,
      attempt_started_at TIMESTAMP NULL DEFAULT NULL,
      PRIMARY KEY (group_id, user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // لیست توهین‌های شوخی‌گروهی برای دستور "لیزه توهین" - علاوه بر لیست پیش‌فرض داخل messages.json،
  // ادمین مادر می‌تواند مورد اضافه/حذف کند که این‌ها اینجا ذخیره می‌شوند
  await query(`
    CREATE TABLE IF NOT EXISTS ${P}insults (
      id INT AUTO_INCREMENT PRIMARY KEY,
      group_id BIGINT NOT NULL,
      text VARCHAR(500) NOT NULL,
      created_by BIGINT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_group_text (group_id, text)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log('[DB] تمام جداول الینالیزه بررسی/ساخته شدند.');
}

module.exports = { initDatabase };
