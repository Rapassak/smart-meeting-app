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
  return { user_id: row.user_id, username: row.username, name: row.name, role: row.role };
}

// POST /api/auth/register  body: { username, password, name, role }
router.post('/register', asyncHandler(async (req, res) => {
  const { username, password, name, role } = req.body || {};

  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ (ชื่อ, ชื่อผู้ใช้, รหัสผ่าน, บทบาท)' });
  }
  if (!['employee', 'organizer', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านควรมีอย่างน้อย 4 ตัวอักษร' });
  }

  const existingResult = await db.execute({ sql: 'SELECT user_id FROM users WHERE username = ?', args: [username] });
  if (existingResult.rows[0]) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว ลองชื่ออื่น' });

  const salt = randomSalt();
  const passwordHash = hashPassword(password, salt);
  const insertResult = await db.execute({
    sql: `INSERT INTO users (username, password_hash, password_salt, name, role) VALUES (?, ?, ?, ?, ?)`,
    args: [username, passwordHash, salt, name.trim(), role],
  });

  const user = { user_id: insertResult.lastInsertRowid, username, name: name.trim(), role };
  const token = randomToken();
  await db.execute({ sql: 'INSERT INTO sessions (token, user_id) VALUES (?, ?)', args: [token, user.user_id] });

  res.status(201).json({ token, user });
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
