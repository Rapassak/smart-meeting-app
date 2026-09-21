// ============================================================================
// routes/dashboard.js — สรุปผลภาพรวมสำหรับแอดมิน
// ============================================================================
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const totalMeetingsResult = await db.execute('SELECT COUNT(*) AS n FROM meetings');
  const totalMeetings = totalMeetingsResult.rows[0].n;

  const pendingResult = await db.execute(`
    SELECT COUNT(*) AS n FROM bookings b
    JOIN meetings m ON m.meeting_id = b.meeting_id
    WHERE b.status = 'pending' AND m.status = 'scheduled'
  `);
  const pendingCount = pendingResult.rows[0].n;

  const cancelledResult = await db.execute(`
    SELECT COUNT(*) AS n FROM meetings m
    WHERE m.status = 'cancelled'
       OR EXISTS (SELECT 1 FROM bookings b WHERE b.meeting_id = m.meeting_id AND b.status = 'rejected')
  `);
  const cancelledCount = cancelledResult.rows[0].n;

  // อัตราเช็คอินเฉลี่ย เฉพาะการประชุมที่มีผู้เข้าร่วมอย่างน้อย 1 คน
  const meetingsWithParticipantsResult = await db.execute(`
    SELECT m.meeting_id,
      (SELECT COUNT(*) FROM participants p WHERE p.meeting_id = m.meeting_id) AS total,
      (SELECT COUNT(*) FROM participants p WHERE p.meeting_id = m.meeting_id AND p.check_in_status = 'checked_in') AS checked
    FROM meetings m
  `);
  const meetingsWithParticipants = meetingsWithParticipantsResult.rows.filter((m) => m.total > 0);

  const avgCheckin = meetingsWithParticipants.length
    ? Math.round(
        (meetingsWithParticipants.reduce((sum, m) => sum + m.checked / m.total, 0) /
          meetingsWithParticipants.length) * 100
      )
    : 0;

  const roomsResult = await db.execute(`
    SELECT r.room_id AS id, r.room_name AS name,
      CASE WHEN EXISTS (
        SELECT 1 FROM bookings b JOIN meetings m ON m.meeting_id = b.meeting_id
        WHERE b.room_id = r.room_id AND b.status IN ('pending','confirmed') AND m.status = 'scheduled'
      ) THEN 'busy' ELSE 'free' END AS status
    FROM rooms r ORDER BY r.room_id
  `);

  res.json({
    totalMeetings,
    pendingCount,
    cancelledCount,
    avgCheckin,
    rooms: roomsResult.rows,
  });
}));

module.exports = router;
