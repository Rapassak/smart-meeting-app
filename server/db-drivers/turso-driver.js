// ============================================================================
// db-drivers/turso-driver.js — ฐานข้อมูลบนคลาวด์ (Turso) สำหรับตอน deploy จริง
// ----------------------------------------------------------------------------
// Turso คือบริการฐานข้อมูล SQLite แบบ "อยู่บนคลาวด์" (ใช้ภาษา SQL แบบเดียวกับ
// SQLite ทุกอย่าง) มี free tier ให้ใช้ฟรีโดยไม่ต้องผูกบัตรเครดิต ข้อดีคือข้อมูล
// จะอยู่ถาวร ไม่หายแม้ deploy เว็บใหม่หรือเว็บ sleep แล้วตื่นขึ้นมา (ต่างจากไฟล์
// SQLite ธรรมดาที่เก็บอยู่บนเครื่องเซิร์ฟเวอร์ ซึ่งจะหายไปตอน deploy ใหม่บน
// hosting ฟรีส่วนใหญ่) — ดูวิธีสมัคร/ตั้งค่าใน README.md หัวข้อ "Deploy ขึ้นเว็บ"
//
// ไฟล์นี้ require('@libsql/client') "แบบ lazy" (เรียกตอนใช้งานจริงเท่านั้น
// ไม่ได้ require ไว้บนสุดของไฟล์) เพื่อให้คนที่ยังไม่ได้ตั้งค่า Turso (รันแค่
// ในเครื่องตัวเอง) ไม่ต้องกังวลเรื่องนี้เลย — ตัวเลือกใช้ driver ไหนถูกตัดสินใน
// db.js จากการเช็คว่ามี environment variable TURSO_DATABASE_URL หรือไม่
// ============================================================================

function createTursoDriver(url, authToken) {
  const { createClient } = require('@libsql/client');
  const client = createClient({ url, authToken });

  // แปลงแถวที่ได้จาก libSQL ให้เป็น plain object ธรรมดาแน่ๆ (กันปัญหา
  // JSON.stringify() ผลลัพธ์ผิดรูปแบบ ถ้า row ที่ libSQL คืนมาไม่ใช่ plain
  // object ตรงๆ) และแปลง lastInsertRowid จาก BigInt เป็น number ปกติ
  function toPlainRow(row, columns) {
    const obj = {};
    columns.forEach((col) => { obj[col] = row[col]; });
    return obj;
  }

  function normalize(result) {
    const columns = result.columns || [];
    const rows = (result.rows || []).map((r) => toPlainRow(r, columns));
    return {
      rows,
      columns,
      rowsAffected: Number(result.rowsAffected || 0),
      lastInsertRowid:
        result.lastInsertRowid === undefined || result.lastInsertRowid === null
          ? undefined
          : Number(result.lastInsertRowid),
    };
  }

  async function execute(sqlOrObj, argsMaybe) {
    const sql = typeof sqlOrObj === 'string' ? sqlOrObj : sqlOrObj.sql;
    const args = typeof sqlOrObj === 'string' ? argsMaybe || [] : sqlOrObj.args || [];
    const result = await client.execute({ sql, args });
    return normalize(result);
  }

  async function batch(statements) {
    const asObjs = statements.map((s) => (typeof s === 'string' ? { sql: s, args: [] } : s));
    const results = await client.batch(asObjs, 'write');
    return results.map(normalize);
  }

  async function execRaw(sql) {
    // ใช้ตอนสร้างตาราง (schema) — แตกเป็นคำสั่งย่อยๆ ด้วย ";" แล้วรันทีละคำสั่ง
    // ผ่าน batch (libSQL ไม่มี exec() แบบรันหลายคำสั่งรวดเดียวแบบ node:sqlite)
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statements.length) await batch(statements);
  }

  return { execute, batch, execRaw };
}

module.exports = { createTursoDriver };
