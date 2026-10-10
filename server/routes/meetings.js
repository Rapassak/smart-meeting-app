// ============================================================================
// routes/meetings.js — API เกี่ยวกับการประชุม (สร้าง / แก้ไข / ยกเลิก / ดูรายการ)
// ============================================================================
const express = require('express');
const db = require('../db');
const { getCurrentUser } = require('../util/session');
const { asyncHandler } = require('../util/async-handler');

const router = express.Router();

// ----------------------------------------------------------------------------
// helper: รวมสถานะของ "การประชุม" (meetings.status) กับสถานะของ "การจองห้อง"
// (bookings.status) ให้เป็นสถานะเดียวที่หน้าเว็บใช้แสดงผล เช่น badge
//   - ถ้าการประชุมถูกยกเลิก             -> cancelled
//   - ถ้ามีการจองห้องและรออนุมัติ         -> pending
//   - ถ้ามีการจองห้องและถูกปฏิเสธ        -> rejected
//   - ถ้าเป็น Online (ไม่มีการจองห้อง) หรือจองห้องผ่านแล้ว -> confirmed
// ----------------------------------------------------------------------------
function overallStatus(row) {
  if (row.meeting_status === 'cancelled') return 'cancelled';
  if (row.booking_status === 'pending') return 'pending';
  if (row.booking_status === 'rejected') return 'rejected';
  return 'confirmed';
}

const LIST_SQL = `
  SELECT
    m.meeting_id, m.title, m.meeting_date, m.start_time, m.meeting_type,
    m.confidential_level, m.meeting_link, m.status AS meeting_status,
    m.organizer_id, m.chair_name,
    b.booking_id, b.room_id, b.status AS booking_status,
    r.room_name,
    u.name AS organizer_name
  FROM meetings m
  LEFT JOIN bookings b ON b.meeting_id = m.meeting_id
  LEFT JOIN rooms r ON r.room_id = b.room_id
  LEFT JOIN users u ON u.user_id = m.organizer_id
  ORDER BY m.meeting_date, m.start_time
`;

function shapeRow(row, participants) {
  return {
    id: row.meeting_id,
    title: row.title,
    date: row.meeting_date,
    time: row.start_time,
    type: row.meeting_type,
    room: row.room_id || '',
    roomName: row.room_name || '',
    link: row.meeting_link || '',
    confidential: row.confidential_level,
    organizer: row.organizer_name,
    organizerId: row.organizer_id || null,
    chairName: row.chair_name || '',
    status: overallStatus(row),
    bookingId: row.booking_id || null,
    // attendees: คนที่เช็คอินเข้าร่วมจริง (ผ่าน QR เท่านั้น ไม่มีรายชื่อล่วงหน้าอีกต่อไป)
    attendees: participants
      .filter((p) => p.check_in_status === 'checked_in')
      .map((p) => ({ name: p.name, position: p.position || '', checkedInAt: p.check_in_time })),
    checkInCount: participants.filter((p) => p.check_in_status === 'checked_in').length,
  };
}

async function getParticipants(meetingId) {
  const result = await db.execute({ sql: 'SELECT * FROM participants WHERE meeting_id = ?', args: [meetingId] });
  return result.rows;
}

async function getOneRow(meetingId) {
  const result = await db.execute({
    sql: LIST_SQL.replace('ORDER BY', 'WHERE m.meeting_id = ? ORDER BY'),
    args: [meetingId],
  });
  return result.rows[0];
}

// GET /api/meetings — รายการการประชุมทั้งหมด
router.get('/', asyncHandler(async (req, res) => {
  const listResult = await db.execute(LIST_SQL);
  const meetings = await Promise.all(
    listResult.rows.map(async (row) => shapeRow(row, await getParticipants(row.meeting_id)))
  );
  res.json(meetings);
}));

// GET /api/meetings/:id — รายละเอียดการประชุมเดียว
router.get('/:id', asyncHandler(async (req, res) => {
  const row = await getOneRow(req.params.id);
  if (!row) return res.status(404).json({ error: 'ไม่พบการประชุมนี้' });
  res.json(shapeRow(row, await getParticipants(row.meeting_id)));
}));

// POST /api/meetings — สร้างการประชุมใหม่
// body: { title, date, time, type, room, link, confidential, chairName }
// หมายเหตุ: ไม่ต้องกรอกรายชื่อผู้เข้าร่วมล่วงหน้าอีกต่อไป เพราะผู้เข้าร่วมจะ
// เช็คอินเข้ามาเองผ่าน QR Code ตอนถึงวันประชุมจริง (ดู routes/checkin.js)
router.post('/', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนสร้างการประชุม' });

  const { title, date, time, type, room, link, confidential, chairName } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อการประชุม' });

  const needsRoom = type !== 'Online';

  const insertResult = await db.execute({
    sql: `INSERT INTO meetings (title, meeting_date, start_time, meeting_type, confidential_level, meeting_link, organizer_id, chair_name, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
    args: [
      title.trim(), date, time, type, confidential || 'ทั่วไป',
      needsRoom ? '' : (link || ''), user.user_id, (chairName || '').trim(),
    ],
  });
  const meetingId = insertResult.lastInsertRowid;

  if (needsRoom && room) {
    await db.execute({ sql: 'INSERT INTO bookings (meeting_id, room_id, status) VALUES (?, ?, ?)', args: [meetingId, room, 'pending'] });
    await db.execute({
      sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
      args: ['มีคำขอจองห้องใหม่', `"${title.trim()}" รอการอนุมัติจากแอดมิน`],
    });
  }

  const row = await getOneRow(meetingId);
  res.status(201).json(shapeRow(row, await getParticipants(meetingId)));
}));

// PUT /api/meetings/:id — แก้ไขการประชุม
router.put('/:id', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนแก้ไขการประชุม' });

  const meetingId = req.params.id;
  const existingResult = await db.execute({ sql: 'SELECT * FROM meetings WHERE meeting_id = ?', args: [meetingId] });
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'ไม่พบการประชุมนี้' });
  if (user.role !== 'admin' && existing.organizer_id !== user.user_id) {
    return res.status(403).json({ error: 'แก้ไขได้เฉพาะการประชุมที่คุณเป็นผู้สร้าง หรือต้องเป็นแอดมิน' });
  }

  const { title, date, time, type, room, link, confidential, chairName } = req.body;
  const needsRoom = type !== 'Online';

  await db.execute({
    sql: `UPDATE meetings SET title=?, meeting_date=?, start_time=?, meeting_type=?,
          confidential_level=?, meeting_link=?, chair_name=? WHERE meeting_id=?`,
    args: [title.trim(), date, time, type, confidential || 'ทั่วไป', needsRoom ? '' : (link || ''), (chairName || '').trim(), meetingId],
  });

  const existingBookingResult = await db.execute({ sql: 'SELECT * FROM bookings WHERE meeting_id = ?', args: [meetingId] });
  const existingBooking = existingBookingResult.rows[0];
  if (needsRoom && room) {
    if (existingBooking) {
      await db.execute({ sql: 'UPDATE bookings SET room_id = ? WHERE booking_id = ?', args: [room, existingBooking.booking_id] });
    } else {
      await db.execute({ sql: 'INSERT INTO bookings (meeting_id, room_id, status) VALUES (?, ?, ?)', args: [meetingId, room, 'pending'] });
    }
  } else if (!needsRoom && existingBooking) {
    // เปลี่ยนเป็น Online แล้ว ไม่ต้องใช้ห้องอีกต่อไป
    await db.execute({ sql: 'DELETE FROM bookings WHERE booking_id = ?', args: [existingBooking.booking_id] });
  }

  // หมายเหตุ: ไม่ลบรายชื่อผู้เข้าร่วม (participants) ทิ้งตอนแก้ไขอีกต่อไป เพราะตอนนี้
  // participants คือคนที่เช็คอินเข้าจริงผ่าน QR แล้ว — การแก้ไขรายละเอียดการประชุม
  // (เช่น เปลี่ยนเวลา/ห้อง) ไม่ควรลบประวัติการเช็คอินที่เกิดขึ้นไปแล้ว

  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['แก้ไขการประชุม', `"${title.trim()}" ได้รับการแก้ไขแล้ว`],
  });

  const row = await getOneRow(meetingId);
  res.json(shapeRow(row, await getParticipants(meetingId)));
}));

// POST /api/meetings/:id/cancel — ยกเลิกการประชุม
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนยกเลิกการประชุม' });

  const meetingId = req.params.id;
  const existingResult = await db.execute({ sql: 'SELECT * FROM meetings WHERE meeting_id = ?', args: [meetingId] });
  const existing = existingResult.rows[0];
  if (!existing) return res.status(404).json({ error: 'ไม่พบการประชุมนี้' });
  if (user.role !== 'admin' && existing.organizer_id !== user.user_id) {
    return res.status(403).json({ error: 'ยกเลิกได้เฉพาะการประชุมที่คุณเป็นผู้สร้าง หรือต้องเป็นแอดมิน' });
  }

  await db.execute({ sql: "UPDATE meetings SET status = 'cancelled' WHERE meeting_id = ?", args: [meetingId] });
  await db.execute({
    sql: 'INSERT INTO notifications (title, message) VALUES (?, ?)',
    args: ['ยกเลิกการประชุม', `"${existing.title}" ถูกยกเลิกแล้ว`],
  });

  res.json({ ok: true });
}));

module.exports = router;
