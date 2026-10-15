// ============================================================================
// routes/password-reset.js — ระบบ "ลืมรหัสผ่าน"
// ----------------------------------------------------------------------------
// ไม่มีเซิร์ฟเวอร์อีเมลให้ส่งลิงก์รีเซ็ต จึงออกแบบเป็น "ส่งคำขอ -> แอดมินรับเรื่อง
// แล้วตั้งรหัสผ่านใหม่ให้" แทน (มีสถานะ pending -> resolved ให้ติดตามได้)
//   POST /api/password-reset/request        - พนักงานกดขอ (ไม่ต้อง login)
//   GET  /api/password-reset/pending         - แอดมินดูคำขอที่รอดำเนินการ
//   POST /api/password-reset/:id/resolve     - แอดมินตั้งรหัสผ่านใหม่ให้ + ปิดคำขอ
// ============================================================================
const express = require('express');
const db = require('../db');
const { randomSalt, hashPassword } = require('../util/password');
const { getCurrentUser } = require('../util/session');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

async function requireAdmin(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
    return null;
  }
  if (user.role !== 'admin') {
    res.status(403).json({ error: 'เฉพาะแอดมินเท่านั้นที่ทำรายการนี้ได้' });
    return null;
  }
  return user;
}

// POST /api/password-reset/request  body: { username } — ไม่ต้อง login
// (เพราะลืมรหัสผ่านแปลว่าเข้าระบบเองไม่ได้อยู่แล้ว)
router.post('/request', asyncHandler(async (req, res) => {
  const { username } = req.body || {};
  if (!username || !username.trim()) {
    return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้ (username)' });
  }

  const userResult = await db.execute({ sql: 'SELECT * FROM users WHERE username = ?', args: [username.trim()] });
  const user = userResult.rows[0];
  if (!user) return res.status(404).json({ error: 'ไม่พบชื่อผู้ใช้นี้ในระบบ' });

  const pendingResult = await db.execute({
    sql: "SELECT request_id FROM password_reset_requests WHERE user_id = ? AND status = 'pending'",
    args: [user.user_id],
  });
  if (pendingResult.rows[0]) {
    return res.json({ ok: true, status: 'pending', message: 'มีคำขอของคุณส่งไปแล้วก่อนหน้านี้ กำลังรอแอดมินดำเนินการอยู่' });
  }

  await db.execute({ sql: 'INSERT INTO password_reset_requests (user_id) VALUES (?)', args: [user.user_id] });
  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['มีคำขอรีเซ็ตรหัสผ่านใหม่', `${user.name} (@${user.username}) ขอรีเซ็ตรหัสผ่าน — ไปที่หน้า "จัดการผู้ใช้" เพื่อดำเนินการ`],
  });

  res.json({ ok: true, status: 'sent', message: 'ส่งคำขอรีเซ็ตรหัสผ่านเรียบร้อยแล้ว รอแอดมินดำเนินการ' });
}));

// GET /api/password-reset/pending — รายการคำขอที่รอดำเนินการ (แอดมินเท่านั้น)
router.get('/pending', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const result = await db.execute(`
    SELECT pr.request_id, pr.requested_at, u.user_id, u.name, u.username
    FROM password_reset_requests pr
    JOIN users u ON u.user_id = pr.user_id
    WHERE pr.status = 'pending'
    ORDER BY pr.requested_at ASC
  `);
  res.json(result.rows);
}));

// POST /api/password-reset/:id/resolve  body: { newPassword } — แอดมินตั้งรหัสผ่าน
// ใหม่ให้โดยตรง แล้วปิดคำขอเป็น resolved (ล้าง session เดิมของคนนั้นด้วย)
router.post('/:id/resolve', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ควรมีอย่างน้อย 4 ตัวอักษร' });
  }

  const requestResult = await db.execute({ sql: 'SELECT * FROM password_reset_requests WHERE request_id = ?', args: [req.params.id] });
  const request = requestResult.rows[0];
  if (!request || request.status !== 'pending') {
    return res.status(404).json({ error: 'ไม่พบคำขอนี้ หรือดำเนินการไปแล้ว' });
  }

  const salt = randomSalt();
  const passwordHash = hashPassword(newPassword, salt);
  await db.execute({
    sql: 'UPDATE users SET password_hash = ?, password_salt = ? WHERE user_id = ?',
    args: [passwordHash, salt, request.user_id],
  });
  await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [request.user_id] });
  await db.execute({
    sql: "UPDATE password_reset_requests SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ? WHERE request_id = ?",
    args: [admin.user_id, req.params.id],
  });

  res.json({ ok: true });
}));

module.exports = router;
