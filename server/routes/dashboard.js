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

  // จำนวนผู้เช็คอินทั้งหมด (รวมทุกการประชุม) — ไม่ใช้ "อัตรา" แบบเดิมแล้ว เพราะ
  // ตอนนี้ไม่มีรายชื่อผู้เข้าร่วมที่กรอกไว้ล่วงหน้าให้หารเป็นเปอร์เซ็นต์อีกต่อไป
  // (ผู้เข้าร่วมทั้งหมดมาจากการเช็คอินผ่าน QR เท่านั้น)
  const checkInCountResult = await db.execute(
    "SELECT COUNT(*) AS n FROM participants WHERE check_in_status = 'checked_in'"
  );
  const totalCheckIns = checkInCountResult.rows[0].n;

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
    totalCheckIns,
    rooms: roomsResult.rows,
  });
}));

module.exports = router;
