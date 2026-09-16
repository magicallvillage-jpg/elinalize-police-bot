// لایه اتصال به MySQL
// از یک connection pool مشترک استفاده می‌شود تا با پایگاه داده ربات دیگر تداخلی نداشته باشد.
const mysql = require('mysql2/promise');
const config = require('../config');

const pool = mysql.createPool(config.db);

/**
 * اجرای یک کوئری ساده و بازگرداندن ردیف‌ها
 */
async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

/**
 * گرفتن یک کانکشن مجزا برای تراکنش‌ها
 */
async function getConnection() {
  return pool.getConnection();
}

module.exports = { pool, query, getConnection };
