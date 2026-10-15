// ============================================================================
// routes/notifications.js
// ----------------------------------------------------------------------------
// user_id ของแถวในตาราง notifications: NULL = แจ้งเตือนกว้างๆ ให้ทุกคนที่
// login อยู่เห็น (เหมือนพฤติกรรมเดิมของระบบ), มีค่า = แจ้งเตือนเฉพาะคนคนนั้น
// (เช่น เตือนใกล้ถึงเวลาประชุม / เตือนให้ลงรายงาน — ดู util/meeting-lifecycle.js)
// ============================================================================
const express = require('express');
const db = require('../db');
const { getCurrentUser } = require('../util/session');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// GET /api/notifications — แจ้งเตือนที่ "ฉัน" ควรเห็น (กว้างๆ + เฉพาะของฉัน) ล่าสุดก่อน
router.get('/', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  const result = user
    ? await db.execute({
        sql: 'SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY notif_id DESC LIMIT 30',
        args: [user.user_id],
      })
    : await db.execute('SELECT * FROM notifications WHERE user_id IS NULL ORDER BY notif_id DESC LIMIT 30');
  res.json(result.rows);
}));

// POST /api/notifications/read-all — mark เฉพาะแจ้งเตือนที่ "ฉัน" เห็นว่าอ่านแล้ว
// (ไม่ไล่ mark ทุกแถวในตารางแบบเดิม เพราะตอนนี้มีแจ้งเตือนเฉพาะคนด้วยแล้ว
// การเข้ามาดูของคนหนึ่งไม่ควรไปมาร์คว่าอ่านแล้วให้แจ้งเตือนส่วนตัวของอีกคน)
router.post('/read-all', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (user) {
    await db.execute({
      sql: 'UPDATE notifications SET is_read = 1 WHERE user_id IS NULL OR user_id = ?',
      args: [user.user_id],
    });
  } else {
    await db.execute('UPDATE notifications SET is_read = 1 WHERE user_id IS NULL');
  }
  res.json({ ok: true });
}));

module.exports = router;
