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
// ไม่เอาแถวที่ "ฉัน" กดปิด/ล้างไปแล้ว (notification_dismissals) — คนอื่นที่ยังไม่เห็น
// ยังเห็นแถวเดิมอยู่ตามปกติ เพราะการปิดเป็นแบบรายคน ไม่ได้ลบข้อมูลจริงทิ้ง
router.get('/', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  const result = user
    ? await db.execute({
        sql: `
          SELECT n.* FROM notifications n
          WHERE (n.user_id IS NULL OR n.user_id = ?)
            AND NOT EXISTS (SELECT 1 FROM notification_dismissals d WHERE d.notif_id = n.notif_id AND d.user_id = ?)
          ORDER BY n.notif_id DESC LIMIT 30
        `,
        args: [user.user_id, user.user_id],
      })
    : await db.execute('SELECT * FROM notifications WHERE user_id IS NULL ORDER BY notif_id DESC LIMIT 30');
  res.json(result.rows);
}));

// POST /api/notifications/:id/dismiss — ปิดการแจ้งเตือนนี้ให้หายไปสำหรับ "ฉัน" คนเดียว
router.post('/:id/dismiss', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  await db.execute({
    sql: 'INSERT OR IGNORE INTO notification_dismissals (notif_id, user_id) VALUES (?, ?)',
    args: [req.params.id, user.user_id],
  });
  res.json({ ok: true });
}));

// POST /api/notifications/dismiss-all — ล้างทุกอันที่ "ฉัน" เห็นอยู่ตอนนี้ (เฉพาะของฉัน)
router.post('/dismiss-all', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  await db.execute({
    sql: `
      INSERT OR IGNORE INTO notification_dismissals (notif_id, user_id)
      SELECT n.notif_id, ? FROM notifications n WHERE n.user_id IS NULL OR n.user_id = ?
    `,
    args: [user.user_id, user.user_id],
  });
  res.json({ ok: true });
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
