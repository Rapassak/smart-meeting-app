// ============================================================================
// util/async-handler.js — ห่อ route handler ที่เป็น async ให้ปลอดภัย
// ----------------------------------------------------------------------------
// Express 4 (เวอร์ชันที่โปรเจกต์นี้ใช้) "ไม่" ดักจับ error ที่เกิดขึ้นใน
// async function ให้อัตโนมัติ — ถ้า Promise ที่ handler คืนกลับไป reject
// (เช่น query ฐานข้อมูลพัง) แล้วไม่มีใครดัก จะทำให้ request นั้นค้างเฉยๆ
// (ไม่ตอบกลับอะไรเลย) แทนที่จะเห็น error ชัดๆ
//
// ฟังก์ชันนี้ห่อ handler ไว้อีกชั้น: ถ้า handler โยน error หรือ Promise reject
// จะส่งต่อ error นั้นไปให้ Express ผ่าน next(err) โดยอัตโนมัติ ซึ่งจะไปเข้า
// error-handling middleware ตัวสุดท้ายใน index.js (ตอบกลับเป็น 500 พร้อม
// ข้อความ แทนที่จะทำให้ request ค้างหรือ process ล่ม)
// ============================================================================
function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
