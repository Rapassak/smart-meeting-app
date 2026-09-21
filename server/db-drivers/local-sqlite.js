// ============================================================================
// db-drivers/local-sqlite.js — ฐานข้อมูลไฟล์ SQLite บนเครื่อง (สำหรับตอนพัฒนา
// ในเครื่องตัวเอง ไม่ต้องมีบัญชีคลาวด์อะไรเลย)
// ----------------------------------------------------------------------------
// ใช้ node:sqlite ที่ติดมากับ Node.js เอง (ตั้งแต่ Node 22+) ไม่ต้อง compile
// โค้ด C++ ตอนติดตั้งเหมือน better-sqlite3 — npm install จะไม่มีวันพังเพราะเรื่องนี้
//
// ไฟล์นี้ทำหน้าที่ "แปลงร่าง" ให้ node:sqlite (ซึ่ง API เป็นแบบ synchronous)
// มีหน้าตาเหมือน @libsql/client (ซึ่ง API เป็นแบบ async ทั้งหมด คืนค่าเป็น
// Promise) เพื่อให้โค้ดส่วนอื่นของโปรเจกต์ (db.js, ทุกไฟล์ใน routes/) เรียกใช้
// งานฐานข้อมูลด้วยหน้าตาเดียวกันทั้งหมด ไม่ว่าจะรันอยู่ในเครื่องหรือรันบน
// เซิร์ฟเวอร์จริงที่ต่อกับ Turso (ดู turso-driver.js เทียบดูได้)
//
// รูปแบบผลลัพธ์ที่คืนกลับ (เหมือนกับ turso-driver.js ทุกประการ):
//   execute(sql, args) -> { rows: [ {col: val, ...}, ... ], lastInsertRowid: number, rowsAffected: number }
//   batch([sql1, sql2, ...]) -> รันหลายคำสั่งเรียงกัน (ใช้ตอนสร้างตาราง)
// ============================================================================
const { DatabaseSync } = require('node:sqlite');

function createLocalSqliteDriver(filePath) {
  const raw = new DatabaseSync(filePath);
  raw.exec('PRAGMA journal_mode = WAL');
  raw.exec('PRAGMA foreign_keys = ON');

  // node:sqlite คืนแถวเป็น object ธรรมดาอยู่แล้ว (ไม่ต้องแปลงอะไรเพิ่ม)
  // แต่ .run() คืน lastInsertRowid มาเป็น BigInt บางกรณี — แปลงเป็น number ปกติ
  // เพื่อให้ JSON.stringify() ใช้ได้ตรงๆ (เหมือนที่ turso-driver.js ทำ)
  function normalizeRunResult(info) {
    return {
      rows: [],
      columns: [],
      rowsAffected: Number(info.changes ?? 0),
      lastInsertRowid:
        info.lastInsertRowid === undefined || info.lastInsertRowid === null
          ? undefined
          : Number(info.lastInsertRowid),
    };
  }

  async function execute(sqlOrObj, argsMaybe) {
    const sql = typeof sqlOrObj === 'string' ? sqlOrObj : sqlOrObj.sql;
    const args = typeof sqlOrObj === 'string' ? argsMaybe || [] : sqlOrObj.args || [];

    const trimmed = sql.trim().toUpperCase();
    const isSelect = trimmed.startsWith('SELECT') || trimmed.startsWith('PRAGMA');

    const stmt = raw.prepare(sql);
    if (isSelect) {
      const rows = stmt.all(...args);
      // ใช้ stmt.columns() แทนการอ่านจาก rows[0] เพราะได้ชื่อคอลัมน์ครบแม้ผลลัพธ์จะว่างเปล่า (0 แถว)
      let columns = [];
      try { columns = stmt.columns().map((c) => c.name); } catch (e) { columns = rows.length ? Object.keys(rows[0]) : []; }
      return { rows, columns, rowsAffected: 0, lastInsertRowid: undefined };
    }
    const info = stmt.run(...args);
    return normalizeRunResult(info);
  }

  async function batch(statements) {
    // statements: array of string หรือ { sql, args }
    const results = [];
    for (const s of statements) {
      results.push(await execute(s));
    }
    return results;
  }

  async function execRaw(sql) {
    // สำหรับรันหลายคำสั่งรวดเดียวแบบ multi-statement (ตอนสร้างตาราง)
    raw.exec(sql);
  }

  return { execute, batch, execRaw };
}

module.exports = { createLocalSqliteDriver };
