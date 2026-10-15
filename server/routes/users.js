// ============================================================================
// routes/users.js — หน้า "จัดการผู้ใช้" สำหรับแอดมินเท่านั้น
// ----------------------------------------------------------------------------
// ทุก endpoint ในไฟล์นี้ต้องเป็นแอดมินเท่านั้นถึงจะเรียกได้ (เช็คด้วย requireAdmin)
// เพราะสมัครสมาชิกเองได้แค่บทบาท employee (ดู routes/auth.js) — บัญชี Admin
// ใหม่ต้องให้แอดมินคนที่มีอยู่แล้วสร้างให้ผ่านหน้านี้เท่านั้น
//
// ฟีเจอร์ในไฟล์นี้:
//   GET    /api/users              - ดูรายชื่อผู้ใช้ทั้งหมด
//   POST   /api/users              - เพิ่มผู้ใช้ใหม่ (employee หรือ admin)
//   PUT    /api/users/:id/role     - เปลี่ยนบทบาทผู้ใช้
//   POST   /api/users/:id/reset-password - รีเซ็ตรหัสผ่านให้ผู้ใช้คนอื่น (แทนระบบลืมรหัสผ่านแบบอีเมล)
//   DELETE /api/users/:id          - ลบบัญชีผู้ใช้
//
// กันไว้ไม่ให้ "แอดมินคนสุดท้าย" ถูกลดสิทธิ์/ลบออกไปจนระบบไม่มีแอดมินเหลือเลย
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

async function countAdmins() {
  const result = await db.execute("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  return result.rows[0].n;
}

const VALID_ACCESS_LEVELS = [1, 2, 3];

// GET /api/users — รายชื่อผู้ใช้ทั้งหมด (ไม่ส่ง password hash/salt กลับไป)
router.get('/', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const result = await db.execute('SELECT user_id, username, name, role, access_level, account_status FROM users ORDER BY user_id');
  res.json(result.rows);
}));

// GET /api/users/pending-accounts — บัญชีที่สมัครเองแล้วรอแอดมินอนุมัติ (ยัง login ไม่ได้)
router.get('/pending-accounts', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;
  const result = await db.execute("SELECT user_id, username, name, access_level FROM users WHERE account_status = 'pending' ORDER BY user_id ASC");
  res.json(result.rows);
}));

// POST /api/users  body: { username, password, name, role, accessLevel }
router.post('/', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const { username, password, name, role, accessLevel } = req.body || {};
  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ (ชื่อผู้ใช้, รหัสผ่าน, ชื่อ, บทบาท)' });
  }
  if (!['employee', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง (ต้องเป็น employee หรือ admin)' });
  }
  if (String(password).length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านควรมีอย่างน้อย 4 ตัวอักษร' });
  }
  const level = VALID_ACCESS_LEVELS.includes(Number(accessLevel)) ? Number(accessLevel) : 3;

  const existingResult = await db.execute({ sql: 'SELECT user_id FROM users WHERE username = ?', args: [username] });
  if (existingResult.rows[0]) return res.status(409).json({ error: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว ลองชื่ออื่น' });

  const salt = randomSalt();
  const passwordHash = hashPassword(password, salt);
  // แอดมินเป็นคนสร้างให้โดยตรง = อนุมัติอยู่แล้วในตัว (account_status = 'active' ทันที)
  const insertResult = await db.execute({
    sql: `INSERT INTO users (username, password_hash, password_salt, name, role, access_level, account_status)
          VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    args: [username, passwordHash, salt, name.trim(), role, level],
  });

  res.status(201).json({ user_id: insertResult.lastInsertRowid, username, name: name.trim(), role, access_level: level, account_status: 'active' });
}));

// POST /api/users/:id/approve-account — อนุมัติบัญชีที่สมัครเองและรออยู่
router.post('/:id/approve-account', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const targetId = Number(req.params.id);
  const targetResult = await db.execute({ sql: 'SELECT * FROM users WHERE user_id = ?', args: [targetId] });
  const target = targetResult.rows[0];
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
  if (target.account_status !== 'pending') {
    return res.status(400).json({ error: 'บัญชีนี้ไม่ได้อยู่ในสถานะรออนุมัติแล้ว' });
  }

  await db.execute({ sql: "UPDATE users SET account_status = 'active' WHERE user_id = ?", args: [targetId] });
  await db.execute({
    sql: 'INSERT INTO notifications (title, message, user_id) VALUES (?, ?, ?)',
    args: ['บัญชีของคุณได้รับการอนุมัติแล้ว', 'เข้าสู่ระบบได้เลยตอนนี้', targetId],
  });

  res.json({ ok: true });
}));

// POST /api/users/:id/reject-account — ปฏิเสธบัญชีที่สมัครเองและรออยู่
router.post('/:id/reject-account', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const targetId = Number(req.params.id);
  const targetResult = await db.execute({ sql: 'SELECT * FROM users WHERE user_id = ?', args: [targetId] });
  const target = targetResult.rows[0];
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
  if (target.account_status !== 'pending') {
    return res.status(400).json({ error: 'บัญชีนี้ไม่ได้อยู่ในสถานะรออนุมัติแล้ว' });
  }

  await db.execute({ sql: "UPDATE users SET account_status = 'rejected' WHERE user_id = ?", args: [targetId] });
  res.json({ ok: true });
}));

// PUT /api/users/:id/access-level  body: { accessLevel }
router.put('/:id/access-level', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const targetId = Number(req.params.id);
  const level = Number((req.body || {}).accessLevel);
  if (!VALID_ACCESS_LEVELS.includes(level)) {
    return res.status(400).json({ error: 'ระดับการเข้าถึงต้องเป็น 1, 2 หรือ 3 เท่านั้น' });
  }

  const targetResult = await db.execute({ sql: 'SELECT user_id FROM users WHERE user_id = ?', args: [targetId] });
  if (!targetResult.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });

  await db.execute({ sql: 'UPDATE users SET access_level = ? WHERE user_id = ?', args: [level, targetId] });
  res.json({ ok: true });
}));

// PUT /api/users/:id/role  body: { role }
router.put('/:id/role', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const targetId = Number(req.params.id);
  const { role } = req.body || {};
  if (!['employee', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'บทบาทไม่ถูกต้อง (ต้องเป็น employee หรือ admin)' });
  }

  const targetResult = await db.execute({ sql: 'SELECT * FROM users WHERE user_id = ?', args: [targetId] });
  const target = targetResult.rows[0];
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });

  if (target.role === 'admin' && role !== 'admin') {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'ต้องมีแอดมินเหลืออย่างน้อย 1 คนในระบบเสมอ ไม่สามารถลดสิทธิ์คนนี้ได้' });
    }
  }

  await db.execute({ sql: 'UPDATE users SET role = ? WHERE user_id = ?', args: [role, targetId] });
  res.json({ ok: true });
}));

// POST /api/users/:id/reset-password  body: { newPassword }
// นี่คือระบบ "ลืมรหัสผ่าน" ของแอป — ไม่มีเซิร์ฟเวอร์อีเมลให้ส่งลิงก์รีเซ็ต
// จึงให้แอดมินเป็นคนตั้งรหัสผ่านใหม่ให้โดยตรงแทน (ผู้ใช้แจ้งแอดมินเพื่อขอรีเซ็ต)
router.post('/:id/reset-password', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const targetId = Number(req.params.id);
  const { newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: 'รหัสผ่านใหม่ควรมีอย่างน้อย 4 ตัวอักษร' });
  }

  const targetResult = await db.execute({ sql: 'SELECT user_id FROM users WHERE user_id = ?', args: [targetId] });
  if (!targetResult.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });

  const salt = randomSalt();
  const passwordHash = hashPassword(newPassword, salt);
  await db.execute({
    sql: 'UPDATE users SET password_hash = ?, password_salt = ? WHERE user_id = ?',
    args: [passwordHash, salt, targetId],
  });
  // ล้าง session เดิมทั้งหมดของผู้ใช้คนนี้ เพื่อความปลอดภัย (ต้อง login ใหม่ด้วยรหัสผ่านใหม่)
  await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [targetId] });

  res.json({ ok: true });
}));

// DELETE /api/users/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const targetId = Number(req.params.id);
  if (targetId === admin.user_id) {
    return res.status(400).json({ error: 'ไม่สามารถลบบัญชีที่กำลังเข้าสู่ระบบอยู่ตอนนี้ได้' });
  }

  const targetResult = await db.execute({ sql: 'SELECT * FROM users WHERE user_id = ?', args: [targetId] });
  const target = targetResult.rows[0];
  if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });

  if (target.role === 'admin') {
    const adminCount = await countAdmins();
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'ต้องมีแอดมินเหลืออย่างน้อย 1 คนในระบบเสมอ ไม่สามารถลบคนนี้ได้' });
    }
  }

  const meetingsResult = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM meetings WHERE organizer_id = ?', args: [targetId] });
  if (meetingsResult.rows[0].n > 0) {
    return res.status(400).json({
      error: 'ลบไม่ได้ เพราะผู้ใช้นี้ยังเป็นผู้สร้างการประชุมที่มีอยู่ในระบบ — ให้ยกเลิกการประชุมเหล่านั้นก่อน หรือเปลี่ยนบทบาทแทนการลบ',
    });
  }

  await db.execute({ sql: 'DELETE FROM sessions WHERE user_id = ?', args: [targetId] });
  await db.execute({ sql: 'DELETE FROM users WHERE user_id = ?', args: [targetId] });
  res.json({ ok: true });
}));

module.exports = router;
