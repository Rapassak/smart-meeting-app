// ============================================================================
// routes/reports.js — รายงานสรุปผลการประชุม (1 การประชุม : 1 รายงาน)
// ----------------------------------------------------------------------------
// บันทึกได้เฉพาะผู้สร้างการประชุม (organizer) หรือแอดมิน — การ "ส่งออก" เป็น
// PDF ทำฝั่ง frontend ล้วนๆ ด้วยหน้าพิมพ์ของเบราว์เซอร์ (window.print()) ไม่มี
// endpoint แยกสำหรับ export เพราะไม่ต้องสร้างไฟล์จริงฝั่งเซิร์ฟเวอร์
// ============================================================================
const express = require('express');
const db = require('../db');
const { getCurrentUser } = require('../util/session');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// GET /api/reports/:meetingId — คืน null ถ้ายังไม่มีรายงาน (ไม่ใช่ 404 เพื่อให้
// ฝั่งหน้าเว็บเช็คง่ายๆ ด้วย if (report) ได้เลย)
router.get('/:meetingId', asyncHandler(async (req, res) => {
  const result = await db.execute({ sql: 'SELECT * FROM meeting_reports WHERE meeting_id = ?', args: [req.params.meetingId] });
  const row = result.rows[0];
  if (!row) return res.json(null);
  res.json({
    summary: row.summary,
    resolutions: row.resolutions,
    action_items: row.action_items,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}));

// POST /api/reports/:meetingId  body: { summary, resolutions, actionItems }
// upsert: ยังไม่มีรายงาน -> สร้างใหม่, มีอยู่แล้ว -> แก้ไขทับ (บันทึกซ้ำได้เรื่อยๆ)
router.post('/:meetingId', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนบันทึกรายงาน' });

  const meetingId = req.params.meetingId;
  const meetingResult = await db.execute({ sql: 'SELECT * FROM meetings WHERE meeting_id = ?', args: [meetingId] });
  const meeting = meetingResult.rows[0];
  if (!meeting) return res.status(404).json({ error: 'ไม่พบการประชุมนี้' });
  if (user.role !== 'admin' && meeting.organizer_id !== user.user_id) {
    return res.status(403).json({ error: 'บันทึกรายงานได้เฉพาะผู้สร้างการประชุม หรือแอดมินเท่านั้น' });
  }

  const { summary, resolutions, actionItems } = req.body || {};
  const existingResult = await db.execute({ sql: 'SELECT report_id FROM meeting_reports WHERE meeting_id = ?', args: [meetingId] });

  if (existingResult.rows[0]) {
    await db.execute({
      sql: `UPDATE meeting_reports SET summary=?, resolutions=?, action_items=?, updated_at=datetime('now') WHERE meeting_id=?`,
      args: [summary || '', resolutions || '', actionItems || '', meetingId],
    });
  } else {
    await db.execute({
      sql: 'INSERT INTO meeting_reports (meeting_id, summary, resolutions, action_items, created_by) VALUES (?, ?, ?, ?, ?)',
      args: [meetingId, summary || '', resolutions || '', actionItems || '', user.user_id],
    });
  }

  res.json({ ok: true });
}));

module.exports = router;
