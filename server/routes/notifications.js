// ============================================================================
// routes/notifications.js
// ============================================================================
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// GET /api/notifications — รายการแจ้งเตือนล่าสุดก่อน
router.get('/', asyncHandler(async (req, res) => {
  const result = await db.execute('SELECT * FROM notifications ORDER BY notif_id DESC LIMIT 30');
  res.json(result.rows);
}));

// POST /api/notifications/read-all — mark ทุกอันว่าอ่านแล้ว
router.post('/read-all', asyncHandler(async (req, res) => {
  await db.execute('UPDATE notifications SET is_read = 1');
  res.json({ ok: true });
}));

module.exports = router;
