// ============================================================================
// routes/rooms.js — API เกี่ยวกับห้องประชุม
// ----------------------------------------------------------------------------
// เดิมห้องจะ "ไม่ว่าง" ถ้ามีคำขอจอง (pending/confirmed) ของการประชุมที่ยังไม่ถูก
// ยกเลิกผูกอยู่กับห้องนั้น — ไม่ได้เทียบวัน/เวลาเลย แปลว่าห้องที่เคยถูกจองไปแล้ว
// จะ "ไม่ว่างตลอดไป" จนกว่าการประชุมนั้นจะจบ/ถูกยกเลิก ทั้งที่จองช่วงเวลาอื่นได้สบายๆ
// (บั๊กที่พบจากการใช้งานจริง) ตอนนี้แก้เป็น: ส่ง date+startTime(+endTime) มาด้วย แล้ว
// เซิร์ฟเวอร์เช็คเฉพาะการจองที่ "ช่วงเวลาทับซ้อนกัน" เท่านั้นว่าห้องไหนไม่ว่าง
// ============================================================================
const express = require('express');
const db = require('../db');
const { asyncHandler } = require('../util/async-handler');
const { meetingRange, rangesOverlap } = require('../util/time-range');

const router = express.Router();

const LIST_ROOMS_SQL = 'SELECT room_id AS id, room_name AS name, location, capacity FROM rooms ORDER BY room_id';

// การจองที่ยังนับว่า "จองอยู่" (ยังไม่ถูกยกเลิก และรออนุมัติ/อนุมัติแล้ว)
const ACTIVE_BOOKINGS_SQL = `
  SELECT b.room_id, m.meeting_id, m.title, m.meeting_date, m.start_time, m.end_time
  FROM bookings b
  JOIN meetings m ON m.meeting_id = b.meeting_id
  WHERE b.status IN ('pending', 'confirmed') AND m.status = 'scheduled'
`;

// GET /api/rooms?date=YYYY-MM-DD&startTime=HH:MM&endTime=HH:MM&excludeMeetingId=123
// ไม่ส่ง date/startTime มา -> ยังไม่รู้ว่าจะเอาห้องไปใช้ช่วงไหน บอกสถานะเป็น "unknown"
// ไปก่อน (ฝั่งหน้าเว็บจะให้เลือกวัน/เวลาก่อนค่อยโชว์ห้องว่าง) — excludeMeetingId ใช้ตอน
// แก้ไขการประชุมเดิม จะได้ไม่ชนกับการจองของตัวเอง
router.get('/', asyncHandler(async (req, res) => {
  const { date, startTime, endTime, excludeMeetingId } = req.query || {};
  const roomsResult = await db.execute(LIST_ROOMS_SQL);

  if (!date || !startTime) {
    res.json(roomsResult.rows.map((r) => ({ ...r, status: 'unknown' })));
    return;
  }

  const wanted = meetingRange(date, startTime, endTime);
  const bookingsResult = await db.execute(ACTIVE_BOOKINGS_SQL);

  const busyRoomIds = new Set();
  for (const row of bookingsResult.rows) {
    if (excludeMeetingId && String(row.meeting_id) === String(excludeMeetingId)) continue;
    const existing = meetingRange(row.meeting_date, row.start_time, row.end_time);
    if (rangesOverlap(wanted, existing)) busyRoomIds.add(row.room_id);
  }

  res.json(roomsResult.rows.map((r) => ({ ...r, status: busyRoomIds.has(r.id) ? 'busy' : 'free' })));
}));

module.exports = router;
