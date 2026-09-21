// ============================================================================
// server/index.js — จุดเริ่มต้นของ backend
// ----------------------------------------------------------------------------
// รันด้วยคำสั่ง:  npm start
// แล้วเปิดเบราว์เซอร์ไปที่ http://localhost:3000
// ============================================================================
const path = require('path');
const express = require('express');
const db = require('./db');

const authRoutes = require('./routes/auth');
const roomRoutes = require('./routes/rooms');
const meetingRoutes = require('./routes/meetings');
const bookingRoutes = require('./routes/bookings');
const checkinRoutes = require('./routes/checkin');
const notificationRoutes = require('./routes/notifications');
const dashboardRoutes = require('./routes/dashboard');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json()); // อ่าน body แบบ JSON ที่ frontend ส่งมา (req.body)

// ----- REST API -----
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/meetings', meetingRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/checkin', checkinRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/dashboard', dashboardRoutes);

// ----- หน้าเว็บ (frontend) -----
// ไฟล์ทั้งหมดใน public/ (index.html, css, js) จะถูกเสิร์ฟตรงๆ
app.use(express.static(path.join(__dirname, '..', 'public')));

// ----- error-handling middleware -----
// ต้องมี 4 พารามิเตอร์ (err, req, res, next) Express ถึงจะรู้ว่านี่คือ
// error handler — ดักทุก error ที่ route handler โยนออกมาผ่าน asyncHandler
// (ดู util/async-handler.js) กันไม่ให้ request ค้างหรือ process ล่มไปเลย
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองใหม่อีกครั้ง' });
});

// รอให้ฐานข้อมูลพร้อมใช้งานก่อน (สร้างตาราง + seed ข้อมูลตัวอย่างเสร็จแล้ว)
// ถึงจะเริ่มรับ request — กันไม่ให้มี request หลุดเข้ามาตอนตารางยังสร้างไม่เสร็จ
db.ready
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Smart Meeting server กำลังทำงานที่ http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('[db] เตรียมฐานข้อมูลไม่สำเร็จ:', err);
    process.exit(1);
  });
