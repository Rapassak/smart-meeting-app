// ============================================================================
// util/password.js — ฟังก์ชันช่วยเรื่องรหัสผ่านและ session token
// ----------------------------------------------------------------------------
// ใช้ crypto ที่มากับ Node.js เลย (ไม่ต้องติดตั้งไลบรารีเพิ่ม เช่น bcrypt ซึ่ง
// บางทีติดปัญหาตอนติดตั้งบนเครื่อง Windows เพราะต้อง compile โค้ด C++)
// - scrypt: ใช้แปลงรหัสผ่าน + salt ให้เป็นค่าที่เก็บลงฐานข้อมูลได้อย่างปลอดภัย
//   (ไม่เก็บรหัสผ่านตรงๆ ถ้าฐานข้อมูลหลุดไป คนร้ายก็ยังเดารหัสผ่านจริงไม่ได้ง่ายๆ)
// - salt: ค่าสุ่มที่ต่อกับรหัสผ่านก่อน hash กันไม่ให้คนสองคนที่ตั้งรหัสผ่าน
//   เหมือนกัน ได้ค่า hash เหมือนกัน
// ============================================================================
const crypto = require('crypto');

function randomSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actualHash = hashPassword(password, salt);
  // ใช้ timingSafeEqual กันการโจมตีแบบ timing attack (เทียบเวลาที่ใช้เทียบ hash)
  const a = Buffer.from(actualHash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function randomToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { randomSalt, hashPassword, verifyPassword, randomToken };
