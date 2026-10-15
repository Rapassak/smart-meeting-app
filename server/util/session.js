// ============================================================================
// util/session.js — ตรวจสอบว่า request นี้ "เข้าสู่ระบบอยู่" หรือไม่
// ----------------------------------------------------------------------------
// วิธีทำงาน: ตอน login/register สำเร็จ เซิร์ฟเวอร์จะสร้าง token สุ่มขึ้นมา 1 อัน
// เก็บลงตาราง sessions คู่กับ user_id แล้วส่ง token นั้นกลับไปให้หน้าเว็บ
// หน้าเว็บจะแนบ token นี้มาทุกครั้งที่เรียก API ผ่าน header:
//   Authorization: Bearer <token>
// ฟังก์ชันนี้แค่เอา token จาก header ไปหาในตาราง sessions ว่าเป็นของใคร
//
// หมายเหตุ: db.execute() เป็น async (คืน Promise) เพราะรองรับทั้งฐานข้อมูล
// ในเครื่อง (node:sqlite) และฐานข้อมูลคลาวด์ (Turso) ด้วยหน้าตาเดียวกัน —
// ฟังก์ชันนี้จึงต้องเป็น async ด้วย และทุกที่ที่เรียกใช้ต้องใส่ await
// ============================================================================
const db = require('../db');

async function getCurrentUser(req) {
  const authHeader = (req.headers && req.headers.authorization) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;

  const result = await db.execute({
    sql: `
      SELECT u.user_id, u.username, u.name, u.role, u.access_level, u.account_status
      FROM sessions s
      JOIN users u ON u.user_id = s.user_id
      WHERE s.token = ?
    `,
    args: [token],
  });

  return result.rows[0] || null;
}

module.exports = { getCurrentUser };
