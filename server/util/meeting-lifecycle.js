// ============================================================================
// util/meeting-lifecycle.js — งาน "พื้นหลัง" สองอย่างที่เกี่ยวกับวงจรชีวิตของการประชุม
// ----------------------------------------------------------------------------
// เพราะ hosting ฟรีที่โปรเจกต์นี้ deploy อยู่ (Render free tier) ไม่มีระบบรัน
// cron job เบื้องหลังตลอดเวลา (เว็บจะ sleep ตอนไม่มีคนใช้งาน) จึงใช้วิธี
// "เช็คแบบขี้เกียจ" (lazy check) แทนการตั้งเวลาจริง: ทุกครั้งที่มีคนเปิดแอป/
// เข้าหน้าไหนก็ตามที่ดึงรายการการประชุม (GET /api/meetings) จะรันสองฟังก์ชันนี้
// ก่อนเสมอ เพื่อไล่เช็คว่ามีการประชุมไหน "ถึงเวลาแจ้งเตือน" หรือ "จบไปแล้ว" บ้าง
// แล้วอัปเดตให้ตรงกับเวลาปัจจุบันจริงๆ
//
//   ข้อจำกัดที่ควรรู้ไว้:
//   1) ถ้าไม่มีใครเปิดแอปเลยช่วงหนึ่ง การแจ้งเตือน/การ archive จะไม่เกิดขึ้น
//      จนกว่าจะมีคนเปิดแอปครั้งถัดไป (ไม่ใช่ real-time 100% แบบ push notification)
//   2) ไม่มีช่อง "เวลาสิ้นสุดการประชุม" แยกต่างหากในระบบ จึงสมมติว่าการประชุม
//      ใช้เวลา ASSUMED_DURATION_MIN นาที (ปรับได้ตรงนี้ที่เดียว)
//   3) เทียบเวลาด้วยเวลาของเครื่องเซิร์ฟเวอร์ตรงๆ (new Date(`${date}T${time}:00`))
//      ถ้า deploy ไว้ในโซนเวลาอื่น (เช่น UTC) อาจมีความคลาดเคลื่อนจากเวลาไทยจริง
//      ไม่กี่ชั่วโมง — เหมาะกับสเกลของโปรเจกต์นี้ ไม่ต้องเพิ่ม dependency จัดการ
//      timezone (เช่น dayjs/luxon) ให้ซับซ้อนเกินไป
// ============================================================================
const db = require('../db');

const REMINDER_WINDOW_MIN = 30;     // แจ้งเตือนล่วงหน้า 30 นาทีก่อนเริ่มประชุม
const ASSUMED_DURATION_MIN = 120;   // สมมติให้การประชุมใช้เวลา 2 ชม. (ดูหมายเหตุข้อ 2 ด้านบน)

function toDate(dateStr, timeStr) {
  return new Date(`${dateStr}T${timeStr}:00`);
}

// แจ้งเตือนผู้สร้างการประชุม (organizer_id) เมื่อใกล้ถึงเวลาประชุม — แจ้งแค่
// ครั้งเดียวต่อการประชุม (กันด้วย reminder_sent) และข้ามการประชุมที่ยังรอ
// อนุมัติห้อง/ถูกปฏิเสธอยู่ (ยังไม่ชัวร์ว่าจะได้ประชุมจริง)
async function sendDueReminders() {
  const now = new Date();
  const result = await db.execute(`
    SELECT m.meeting_id, m.title, m.meeting_date, m.start_time, m.organizer_id,
      (SELECT b.status FROM bookings b WHERE b.meeting_id = m.meeting_id) AS booking_status
    FROM meetings m
    WHERE m.status = 'scheduled' AND m.reminder_sent = 0 AND m.organizer_id IS NOT NULL
  `);
  for (const row of result.rows) {
    if (row.booking_status === 'pending' || row.booking_status === 'rejected') continue;
    const start = toDate(row.meeting_date, row.start_time);
    const diffMin = (start - now) / 60000;
    if (diffMin <= REMINDER_WINDOW_MIN) {
      if (diffMin > -ASSUMED_DURATION_MIN) {
        await db.execute({
          sql: 'INSERT INTO notifications (title, message, user_id) VALUES (?, ?, ?)',
          args: ['ใกล้ถึงเวลาประชุม', `"${row.title}" เวลา ${row.start_time} น. — อย่าลืมเข้าร่วม!`, row.organizer_id],
        });
      }
      await db.execute({ sql: 'UPDATE meetings SET reminder_sent = 1 WHERE meeting_id = ?', args: [row.meeting_id] });
    }
  }
}

// ย้ายการประชุมที่หมดเวลาแล้วออกจากรายการหลัก (status: scheduled -> completed)
// ไม่ได้ลบข้อมูลทิ้ง — ยังดูย้อนหลังได้ในแท็บ "ประวัติการประชุม" (history-view)
// พร้อมแจ้งเตือนผู้สร้างให้มาลงรายงานสรุปผลการประชุม
async function archiveEndedMeetings() {
  const now = new Date();
  const result = await db.execute("SELECT meeting_id, title, meeting_date, start_time, organizer_id FROM meetings WHERE status = 'scheduled'");
  for (const row of result.rows) {
    const end = new Date(toDate(row.meeting_date, row.start_time).getTime() + ASSUMED_DURATION_MIN * 60000);
    if (now > end) {
      await db.execute({ sql: "UPDATE meetings SET status = 'completed' WHERE meeting_id = ?", args: [row.meeting_id] });
      if (row.organizer_id) {
        await db.execute({
          sql: 'INSERT INTO notifications (title, message, user_id) VALUES (?, ?, ?)',
          args: ['กรุณาลงรายงานการประชุม', `การประชุม "${row.title}" จบแล้ว อย่าลืมบันทึกรายงานสรุปผลการประชุม`, row.organizer_id],
        });
      }
    }
  }
}

module.exports = { sendDueReminders, archiveEndedMeetings };
