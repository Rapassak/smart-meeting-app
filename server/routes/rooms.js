// ============================================================================
// routes/rooms.js — API เกี่ยวกับห้องประชุม
// ============================================================================
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// ห้องจะ "ไม่ว่าง" ถ้ามีคำขอจอง (pending หรือ confirmed) ของการประชุมที่ยัง
// ไม่ถูกยกเลิก ผูกอยู่กับห้องนั้น — คำนวณสดทุกครั้งที่เรียก แทนที่จะเก็บ
// สถานะ "ว่าง/ไม่ว่าง" ตายตัวไว้ในตาราง (กันข้อมูลไม่ตรงกัน)
const LIST_ROOMS_SQL = `
  SELECT
    r.room_id   AS id,
    r.room_name AS name,
    r.location,
    r.capacity,
    CASE WHEN EXISTS (
      SELECT 1 FROM bookings b
      JOIN meetings m ON m.meeting_id = b.meeting_id
      WHERE b.room_id = r.room_id
        AND b.status IN ('pending', 'confirmed')
        AND m.status = 'scheduled'
    ) THEN 'busy' ELSE 'free' END AS status
  FROM rooms r
  ORDER BY r.room_id
`;

// GET /api/rooms — รายการห้องทั้งหมดพร้อมสถานะว่าง/ไม่ว่าง
router.get('/', asyncHandler(async (req, res) => {
  const result = await db.execute(LIST_ROOMS_SQL);
  res.json(result.rows);
}));

module.exports = router;
