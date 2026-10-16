// ============================================================================
// util/time-range.js — ช่วยเทียบ "ช่วงเวลา" ของการประชุม (วัน+เวลาเริ่ม+เวลาจบ)
// ว่าทับซ้อนกันหรือไม่ — ใช้ร่วมกันทั้งตอนเช็คห้องว่าง (routes/rooms.js) และ
// ตอนกันชนไม่ให้สร้าง/แก้ไขการประชุมไปจองห้องที่ถูกจองไปแล้วในช่วงเวลาเดียวกัน
// (routes/meetings.js) — แยกมาไว้ที่เดียวกันทั้งคู่ จะได้ไม่ต้องคำนวณซ้ำสองที่
// แบบไม่ตรงกัน
// ----------------------------------------------------------------------------
// หมายเหตุ: ระบบนี้ไม่รองรับการประชุมข้ามวัน (เวลาจบอยู่คนละวันกับเวลาเริ่ม)
// ถือว่าทุกการประชุมจบภายในวันเดียวกับที่เริ่ม เหมาะกับสเกลของโปรเจกต์นี้
// ============================================================================

// ไม่ได้กรอกเวลาจบไว้ (การประชุมเก่าก่อนมีฟีเจอร์นี้ หรือกรอกผิดจนเวลาจบไม่อยู่
// หลังเวลาเริ่ม) ให้สมมติว่าใช้เวลานี้แทน — ใช้ค่าเดียวกับ meeting-lifecycle.js
const ASSUMED_DURATION_MIN = 120;

function toMinutes(timeStr) {
  const [h, m] = String(timeStr).split(':').map(Number);
  return h * 60 + (m || 0);
}

// แปลง (วันที่, เวลาเริ่ม, เวลาจบ) ให้เป็นช่วงเวลาเป็นนาที เทียบกันได้ตรงไปตรงมา
function meetingRange(dateStr, startStr, endStr) {
  const start = toMinutes(startStr);
  let end = endStr ? toMinutes(endStr) : start + ASSUMED_DURATION_MIN;
  if (end <= start) end = start + ASSUMED_DURATION_MIN; // กันเวลาจบกรอกผิด (อยู่ก่อนเวลาเริ่ม)
  return { date: dateStr, start, end };
}

// ช่วงเวลาสองช่วงทับซ้อนกันไหม (คนละวันถือว่าไม่ชนกันเสมอ)
function rangesOverlap(a, b) {
  if (a.date !== b.date) return false;
  return a.start < b.end && b.start < a.end;
}

module.exports = { meetingRange, rangesOverlap, toMinutes, ASSUMED_DURATION_MIN };
