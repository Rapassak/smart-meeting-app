// ============================================================================
// routes/meetings.js — API เกี่ยวกับการประชุม (สร้าง / แก้ไข / ยกเลิก / ดูรายการ)
// ============================================================================
const express = require('express');
const db = require('../db');
const { getCurrentUser } = require('../util/session');
const { asyncHandler } = require('../util/async-handler');
const { sendDueReminders, archiveEndedMeetings } = require('../util/meeting-lifecycle');
const { meetingRange, rangesOverlap } = require('../util/time-range');

const router = express.Router();

// เช็คว่าห้องที่จะจองชนกับการจองอื่นที่ "ช่วงเวลาทับซ้อนกัน" หรือเปล่า (ห้องเดียวกัน
// จองคนละช่วงเวลาได้ตามปกติ ไม่ใช่ว่าห้องถูกจองไปแล้วจะไม่ว่างตลอดไป) — excludeMeetingId
// ใช้ตอนแก้ไขการประชุมเดิม จะได้ไม่ชนกับการจองของตัวเอง
async function findRoomConflict(roomId, date, startTime, endTime, excludeMeetingId) {
  const bookingsResult = await db.execute({
    sql: `
      SELECT m.meeting_id, m.title, m.meeting_date, m.start_time, m.end_time
      FROM bookings b
      JOIN meetings m ON m.meeting_id = b.meeting_id
      WHERE b.room_id = ? AND b.status IN ('pending', 'confirmed') AND m.status = 'scheduled'
    `,
    args: [roomId],
  });
  const wanted = meetingRange(date, startTime, endTime);
  for (const row of bookingsResult.rows) {
    if (excludeMeetingId && String(row.meeting_id) === String(excludeMeetingId)) continue;
    const existing = meetingRange(row.meeting_date, row.start_time, row.end_time);
    if (rangesOverlap(wanted, existing)) return row;
  }
  return null;
}

// ----------------------------------------------------------------------------
// ระดับชั้นความลับ 3 ระดับคงที่ + สิทธิ์การเข้าถึงของผู้ใช้ (access_level 1-3
// บนตาราง users — 1 คือสูงสุดมองเห็นได้ทุกระดับ, 3 คือต่ำสุดเห็นได้แค่ "ทั่วไป")
//   CONFIDENTIAL_RANK: ยิ่งตัวเลขมาก ยิ่งเป็นระดับที่ "ไม่ลับ" มาก (เห็นง่าย)
//   กฎ: ผู้ใช้เห็นการประชุมได้ก็ต่อเมื่อ user.access_level <= rank ของระดับนั้น
//   แอดมินเห็นได้ทุกการประชุมเสมอ ไม่ติดเงื่อนไขนี้
// ----------------------------------------------------------------------------
const CONFIDENTIAL_LEVELS = ['ทั่วไป', 'ลับ', 'ลับมาก'];
const CONFIDENTIAL_RANK = { 'ทั่วไป': 3, 'ลับ': 2, 'ลับมาก': 1 };

function canSeeConfidential(user, level) {
  if (user && user.role === 'admin') return true;
  const userLevel = user ? Number(user.access_level) || 3 : 3;
  const rank = Object.prototype.hasOwnProperty.call(CONFIDENTIAL_RANK, level) ? CONFIDENTIAL_RANK[level] : 1; // ค่าที่ไม่รู้จัก ถือว่าลับสุด (ปลอดภัยไว้ก่อน)
  return userLevel <= rank;
}

// ----------------------------------------------------------------------------
// helper: รวมสถานะของ "การประชุม" (meetings.status) กับสถานะของ "การจองห้อง"
// (bookings.status) ให้เป็นสถานะเดียวที่หน้าเว็บใช้แสดงผล เช่น badge
//   - ถ้าการประชุมถูกยกเลิก             -> cancelled
//   - ถ้าหมดเวลาไปแล้ว (เซิร์ฟเวอร์ archive อัตโนมัติ) -> completed
//   - ถ้ามีการจองห้องและรออนุมัติ         -> pending
//   - ถ้ามีการจองห้องและถูกปฏิเสธ        -> rejected
//   - ถ้าเป็น Online (ไม่มีการจองห้อง) หรือจองห้องผ่านแล้ว -> confirmed
// ----------------------------------------------------------------------------
function overallStatus(row) {
  if (row.meeting_status === 'cancelled') return 'cancelled';
  if (row.meeting_status === 'completed') return 'completed';
  if (row.booking_status === 'pending') return 'pending';
  if (row.booking_status === 'rejected') return 'rejected';
  return 'confirmed';
}

const LIST_SQL = `
  SELECT
    m.meeting_id, m.title, m.meeting_date, m.start_time, m.end_time, m.meeting_type,
    m.confidential_level, m.meeting_link, m.status AS meeting_status,
    m.organizer_id, m.chair_name,
    b.booking_id, b.room_id, b.status AS booking_status,
    r.room_name,
    u.name AS organizer_name,
    rpt.report_id AS report_id
  FROM meetings m
  LEFT JOIN bookings b ON b.meeting_id = m.meeting_id
  LEFT JOIN rooms r ON r.room_id = b.room_id
  LEFT JOIN users u ON u.user_id = m.organizer_id
  LEFT JOIN meeting_reports rpt ON rpt.meeting_id = m.meeting_id
  ORDER BY m.meeting_date, m.start_time
`;

function shapeRow(row, participants) {
  return {
    id: row.meeting_id,
    title: row.title,
    date: row.meeting_date,
    time: row.start_time,
    endTime: row.end_time || '',
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
    reportFiled: !!row.report_id,
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
// ก่อนดึงรายการทุกครั้ง จะไล่เช็คก่อนว่ามีการประชุมไหน "ถึงเวลาแจ้งเตือน" หรือ
// "จบไปแล้ว" บ้าง (lazy check แทน cron job จริง — ดู util/meeting-lifecycle.js)
router.get('/', asyncHandler(async (req, res) => {
  await archiveEndedMeetings();
  await sendDueReminders();

  const user = await getCurrentUser(req);
  const listResult = await db.execute(LIST_SQL);
  const visibleRows = listResult.rows.filter((row) => canSeeConfidential(user, row.confidential_level));
  const meetings = await Promise.all(
    visibleRows.map(async (row) => shapeRow(row, await getParticipants(row.meeting_id)))
  );
  res.json(meetings);
}));

// GET /api/meetings/:id — รายละเอียดการประชุมเดียว
// (ถ้าระดับการเข้าถึงไม่พอ ตอบ 404 เหมือนไม่มีการประชุมนี้อยู่ — ไม่บอกว่ามีแต่ดูไม่ได้
// เพื่อไม่ให้รู้ว่ามีการประชุมลับอยู่ตรงนั้นทั้งที่เข้าไม่ถึง)
router.get('/:id', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  const row = await getOneRow(req.params.id);
  if (!row || !canSeeConfidential(user, row.confidential_level)) {
    return res.status(404).json({ error: 'ไม่พบการประชุมนี้' });
  }
  res.json(shapeRow(row, await getParticipants(row.meeting_id)));
}));

// POST /api/meetings — สร้างการประชุมใหม่
// body: { title, date, time, type, room, link, confidential, chairName }
// หมายเหตุ: ไม่ต้องกรอกรายชื่อผู้เข้าร่วมล่วงหน้าอีกต่อไป เพราะผู้เข้าร่วมจะ
// เช็คอินเข้ามาเองผ่าน QR Code ตอนถึงวันประชุมจริง (ดู routes/checkin.js)
router.post('/', asyncHandler(async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อนสร้างการประชุม' });

  const { title, date, time, endTime, type, room, link, confidential, chairName } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'กรุณากรอกชื่อการประชุม' });

  let confidentialLevel = (confidential || 'ทั่วไป').trim();
  if (!CONFIDENTIAL_LEVELS.includes(confidentialLevel)) confidentialLevel = 'ทั่วไป';
  if (!canSeeConfidential(user, confidentialLevel)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์สร้างการประชุมระดับความลับนี้ (สูงกว่าระดับการเข้าถึงของคุณ)' });
  }

  const needsRoom = type !== 'Online';

  if (needsRoom && room) {
    const conflict = await findRoomConflict(room, date, time, endTime, null);
    if (conflict) {
      return res.status(409).json({
        error: `ห้องนี้ถูกจองในช่วงเวลาที่ทับซ้อนกันแล้ว (การประชุม "${conflict.title}" วันที่ ${conflict.meeting_date} เวลา ${conflict.start_time}${conflict.end_time ? '-' + conflict.end_time : ''} น.) กรุณาเลือกห้องหรือเวลาอื่น`,
      });
    }
  }

  const insertResult = await db.execute({
    sql: `INSERT INTO meetings (title, meeting_date, start_time, end_time, meeting_type, confidential_level, meeting_link, organizer_id, chair_name, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled')`,
    args: [
      title.trim(), date, time, (endTime || '').trim() || null, type, confidentialLevel,
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

  const { title, date, time, endTime, type, room, link, confidential, chairName } = req.body;
  const needsRoom = type !== 'Online';

  let confidentialLevel = (confidential || 'ทั่วไป').trim();
  if (!CONFIDENTIAL_LEVELS.includes(confidentialLevel)) confidentialLevel = 'ทั่วไป';
  if (!canSeeConfidential(user, confidentialLevel)) {
    return res.status(403).json({ error: 'คุณไม่มีสิทธิ์ตั้งระดับความลับนี้ (สูงกว่าระดับการเข้าถึงของคุณ)' });
  }

  // เช็คก่อนแก้ไขอะไรลง DB จริง — ถ้าชนกัน จะได้ไม่มีการอัปเดตค้างคาแบบครึ่งๆ กลางๆ
  if (needsRoom && room) {
    const conflict = await findRoomConflict(room, date, time, endTime, meetingId);
    if (conflict) {
      return res.status(409).json({
        error: `ห้องนี้ถูกจองในช่วงเวลาที่ทับซ้อนกันแล้ว (การประชุม "${conflict.title}" วันที่ ${conflict.meeting_date} เวลา ${conflict.start_time}${conflict.end_time ? '-' + conflict.end_time : ''} น.) กรุณาเลือกห้องหรือเวลาอื่น`,
      });
    }
  }

  await db.execute({
    sql: `UPDATE meetings SET title=?, meeting_date=?, start_time=?, end_time=?, meeting_type=?,
          confidential_level=?, meeting_link=?, chair_name=? WHERE meeting_id=?`,
    args: [title.trim(), date, time, (endTime || '').trim() || null, type, confidentialLevel, needsRoom ? '' : (link || ''), (chairName || '').trim(), meetingId],
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
