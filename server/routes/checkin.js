// ============================================================================
// routes/checkin.js — เช็คอินเข้าร่วมประชุมด้วย QR Code จริง
// ----------------------------------------------------------------------------
// ไม่ต้อง login ก่อนเช็คอิน (ตามที่ตัดสินใจไว้ — สแกน QR แล้วกรอกชื่อ+ตำแหน่งได้เลย)
// หน้าเว็บจะพาไปที่ /checkin/:meetingId (ดู server/index.js + public/index.html)
// ให้กรอกชื่อกับตำแหน่ง แล้วกดยืนยัน จะเรียก endpoint นี้
// ============================================================================
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// GET /api/checkin/:meetingId — ใช้ตอนเปิดหน้าเช็คอินจาก QR เพื่อแสดงชื่อการประชุม
router.get('/:meetingId', asyncHandler(async (req, res) => {
  const { meetingId } = req.params;
  const meetingResult = await db.execute({ sql: 'SELECT * FROM meetings WHERE meeting_id = ?', args: [meetingId] });
  const meeting = meetingResult.rows[0];
  if (!meeting) return res.status(404).json({ error: 'ไม่พบการประชุมนี้ (QR อาจไม่ถูกต้อง)' });
  if (meeting.status !== 'scheduled') return res.status(400).json({ error: 'การประชุมนี้ถูกยกเลิกไปแล้ว ไม่สามารถเช็คอินได้' });
  res.json({
    id: meeting.meeting_id,
    title: meeting.title,
    date: meeting.meeting_date,
    time: meeting.start_time,
    chairName: meeting.chair_name || '',
  });
}));

// POST /api/checkin/:meetingId  body: { name, position }
router.post('/:meetingId', asyncHandler(async (req, res) => {
  const { meetingId } = req.params;
  const { name, position } = req.body || {};

  if (!name || !name.trim()) {
    return res.status(400).json({ ok: false, error: 'กรุณากรอกชื่อ' });
  }

  const meetingResult = await db.execute({ sql: 'SELECT * FROM meetings WHERE meeting_id = ?', args: [meetingId] });
  const meeting = meetingResult.rows[0];
  if (!meeting || meeting.status !== 'scheduled') {
    return res.status(400).json({ ok: false, error: 'ไม่สามารถเช็คอินได้ (ไม่พบการประชุม หรือถูกยกเลิกไปแล้ว)' });
  }

  const who = name.trim();
  const whatPosition = (position || '').trim();

  // แต่ละคนเช็คอินได้ครั้งเดียวต่อการประชุม (กันกดซ้ำซ้อน) — จับคู่ด้วยชื่อ+ตำแหน่ง
  const participantResult = await db.execute({
    sql: 'SELECT * FROM participants WHERE meeting_id = ? AND name = ? AND position = ?',
    args: [meetingId, who, whatPosition],
  });
  let participant = participantResult.rows[0];

  if (!participant) {
    const insertResult = await db.execute({
      sql: 'INSERT INTO participants (meeting_id, name, position) VALUES (?, ?, ?)',
      args: [meetingId, who, whatPosition],
    });
    participant = { participant_id: insertResult.lastInsertRowid };
  }

  await db.execute({
    sql: `UPDATE participants SET check_in_status = 'checked_in', check_in_time = datetime('now')
          WHERE participant_id = ?`,
    args: [participant.participant_id],
  });

  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['มีผู้เช็คอินใหม่', `${who}${whatPosition ? ' (' + whatPosition + ')' : ''} เช็คอินเข้าร่วม "${meeting.title}" แล้ว`],
  });

  res.json({ ok: true, name: who, position: whatPosition, meetingTitle: meeting.title });
}));

module.exports = router;
