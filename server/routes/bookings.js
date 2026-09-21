// ============================================================================
// routes/bookings.js — อนุมัติ/ปฏิเสธคำขอจองห้อง (งานของแอดมิน)
// ============================================================================
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// GET /api/bookings/pending — คำขอจองห้องที่รออนุมัติ
router.get('/pending', asyncHandler(async (req, res) => {
  const result = await db.execute(`
    SELECT b.booking_id, b.meeting_id, m.title, m.meeting_date, m.start_time, r.room_name
    FROM bookings b
    JOIN meetings m ON m.meeting_id = b.meeting_id
    JOIN rooms r ON r.room_id = b.room_id
    WHERE b.status = 'pending' AND m.status = 'scheduled'
    ORDER BY m.meeting_date, m.start_time
  `);
  res.json(result.rows);
}));

// POST /api/bookings/:id/approve
router.post('/:id/approve', asyncHandler(async (req, res) => {
  const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE booking_id = ?', args: [req.params.id] });
  const booking = bookingResult.rows[0];
  if (!booking) return res.status(404).json({ error: 'ไม่พบคำขอจองนี้' });

  await db.execute({ sql: "UPDATE bookings SET status = 'confirmed' WHERE booking_id = ?", args: [booking.booking_id] });
  const meetingResult = await db.execute({ sql: 'SELECT title FROM meetings WHERE meeting_id = ?', args: [booking.meeting_id] });
  const meeting = meetingResult.rows[0];
  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['คำขอจองห้องได้รับการอนุมัติ', `"${meeting.title}" อนุมัติแล้ว`],
  });

  res.json({ ok: true });
}));

// POST /api/bookings/:id/reject
router.post('/:id/reject', asyncHandler(async (req, res) => {
  const bookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE booking_id = ?', args: [req.params.id] });
  const booking = bookingResult.rows[0];
  if (!booking) return res.status(404).json({ error: 'ไม่พบคำขอจองนี้' });

  await db.execute({ sql: "UPDATE bookings SET status = 'rejected' WHERE booking_id = ?", args: [booking.booking_id] });
  const meetingResult = await db.execute({ sql: 'SELECT title FROM meetings WHERE meeting_id = ?', args: [booking.meeting_id] });
  const meeting = meetingResult.rows[0];
  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['คำขอจองห้องถูกปฏิเสธ', `"${meeting.title}" ไม่ได้รับการอนุมัติ`],
  });

  res.json({ ok: true });
}));

module.exports = router;
