// ============================================================================
// routes/auth.js — สมัครสมาชิก / เข้าสู่ระบบ / ออกจากระบบ ด้วยจริง
// ----------------------------------------------------------------------------
// ผู้ใช้กรอก username + password เอง ไม่ต้องเลือกบทบาททุกครั้งที่ login แล้ว
// เพราะบทบาท (role) ถูกกำหนดไว้ตอนสมัครสมาชิก แล้วเก็บลงฐานข้อมูลถาวร
//
// วิธีจำ session: ตอน login/register สำเร็จ จะสร้าง token สุ่มขึ้นมา เก็บลง
// ตาราง sessions แล้วส่งกลับไปให้หน้าเว็บเก็บไว้ (ดู public/index.html —
// เก็บ token นี้ใน localStorage) หน้าเว็บจะแนบ token มาทุก request ผ่าน header
// Authorization: Bearer <token> เพื่อบอกว่ากำลังคุยในนามใคร
// ============================================================================
const express = require('express');
const db = require('../db');
const { randomSalt, hashPassword, verifyPassword, randomToken } = require('../util/password');
const { getCurrentUser } = require('../util/session');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

function publicUser(row) {
  return {
    user_id: row.user_id, username: row.username, name: row.name, role: row.role,
    access_level: row.access_level, account_status: row.account_status,
  };
}

const VALID_ACCESS_LEVELS = [1, 2, 3];

// POST /api/auth/register  body: { username, password, name, accessLevel }
// หมายเหตุ: สมัครสมาชิกเองได้แค่บทบาท "พนักงาน" (employee) เท่านั้น
// ไอดี Admin ต้องให้แอดมินคนที่มีอยู่แล้วเป็นคนสร้างให้ผ่านหน้า "จัดการผู้ใช้"
// (ดู routes/users.js) ต่อให้ client ส่ง role มาด้วยก็จะถูกเพิกเฉย/บังคับเป็น employee เสมอ
//
// บัญชีที่สมัครเองจะได้สถานะ 'pending' เสมอ (ยัง login ไม่ได้) — ผู้สมัครเป็นคน
// เลือกระดับการเข้าถึงชั้นความลับของตัวเอง (accessLevel) ตอนสมัคร แล้วแอดมินเป็น
// คนกดอนุมัติให้ใช้งานได้จริงอีกที (ดู routes/users.js: POST /:id/approve-account)
router.post('/register', asyncHandler(async (req, res) => {
  const { username, password, name, accessLevel } = req.body || {};
  const role = 'employee';
  const level = VALID_ACCESS_LEVELS.includes(Number(accessLevel)) ? Number(accessLevel) : 3;

  if (!username || !password || !name) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ (ชื่อ, ชื่อผู้ใช้, รหัสผ่าน)' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านควรมีอย่างน้อย 4 ตัวอักษร' });
  }

  const existingResult = await db.execute({ sql: 'SELECT user_id FROM users WHERE username = ?', args: [username] });
  if (existingResult.rows[0]) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว ลองชื่ออื่น' });

  const salt = randomSalt();
  const passwordHash = hashPassword(password, salt);
  await db.execute({
    sql: `INSERT INTO users (username, password_hash, password_salt, name, role, access_level, account_status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    args: [username, passwordHash, salt, name.trim(), role, level],
  });

  // แจ้งเตือนแอดมิน (กว้างๆ เหมือนแจ้งเตือนคำขออื่นๆ ที่ต้องให้แอดมินมาดำเนินการ)
  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['มีบัญชีใหม่รอการอนุมัติ', `${name.trim()} (@${username}) สมัครสมาชิกใหม่ — ไปที่หน้า "จัดการผู้ใช้" เพื่ออนุมัติ`],
  });

  res.status(201).json({
    ok: true,
    status: 'pending',
    message: 'สมัครสมาชิกสำเร็จ — กรุณารอแอดมินอนุมัติบัญชีก่อน ถึงจะเข้าสู่ระบบได้',
  });
}));

// POST /api/auth/login  body: { username, password }
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
  }

  const result = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username] });
  const row = result.rows[0];
  if (!row || !verifyPassword(password, row.password_salt, row.password_hash)) {
    return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  }
  if (row.account_status === 'pending') {
    return res.status(403).json({ error: 'บัญชีของคุณกำลังรอการอนุมัติจากแอดมิน กรุณารอสักครู่แล้วลองใหม่' });
  }
  if (row.account_status === 'rejected') {
    return res.status(403).json({ error: 'บัญชีนี้ไม่ได้รับการอนุมัติให้ใช้งาน กรุณาติดต่อแอดมิน' });
  }

  const token = randomToken();
  await db.execute({ sql: 'INSERT INTO sessions (token, user_id) VALUES (?, ?)', args: [token, row.user_id] });

  res.json({ token, user: publicUser(row) });
}));

// GET /api/auth/me  header: Authorization: Bearer <token>
// ใช้ตอนเปิดเว็บ/รีเฟรชหน้า เพื่อเช็คว่า token ที่หน้าเว็บเก็บไว้ยังใช้ได้อยู่ไหม
router.get('/me', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'ยังไม่ได้เข้าสู่ระบบ หรือ session หมดอายุ' });
  res.json(user);
}));

// POST /api/auth/logout  header: Authorization: Bearer <token>
router.post('/logout', asyncHandler(async (req, res) => {
  const authHeader = (req.headers && req.headers.authorization) || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) await db.execute({ sql: 'DELETE FROM sessions WHERE token = ?', args: [token] });
  res.json({ ok: true });
}));

module.exports = router;
