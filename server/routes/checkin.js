// ============================================================================
// routes/checkin.js — เช็คอินด้วย QR (จำลอง ไม่มีกล้องจริง)
// ============================================================================
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// POST /api/checkin  body: { meetingId, name }
router.post('/', asyncHandler(async (req, res) => {
  const { meetingId, name } = req.body;
  const meetingResult = await db.execute({ sql: 'SELECT * FROM meetings WHERE meeting_id = ?', args: [meetingId] });
  const meeting = meetingResult.rows[0];
  if (!meeting || meeting.status !== 'scheduled') {
    return res.status(400).json({ ok: false, message: 'ไม่สามารถเช็คอินได้' });
  }

  const who = (name && name.trim()) || 'ผู้ใช้ปัจจุบัน';
  const participantResult = await db.execute({
    sql: 'SELECT * FROM participants WHERE meeting_id = ? AND name = ?',
    args: [meetingId, who],
  });
  let participant = participantResult.rows[0];

  // ในเดโมนี้ยอมให้เช็คอินได้แม้ไม่ได้อยู่ในรายชื่อผู้เข้าร่วมเดิม
  // (ของจริงควรตรวจสิทธิ์จากรายชื่อผู้เข้าร่วมที่ผูกกับ user_id เท่านั้น)
  if (!participant) {
    const insertResult = await db.execute({ sql: 'INSERT INTO participants (meeting_id, name) VALUES (?, ?)', args: [meetingId, who] });
    participant = { participant_id: insertResult.lastInsertRowid };
  }

  await db.execute({
    sql: `UPDATE participants SET check_in_status = 'checked_in', check_in_time = datetime('now')
          WHERE participant_id = ?`,
    args: [participant.participant_id],
  });

  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['มีผู้เช็คอินใหม่', `${who} เช็คอินเข้าร่วม "${meeting.title}" แล้ว`],
  });

  res.json({ ok: true, message: 'เช็คอินสำเร็จ', name: who });
}));

module.exports = router;
