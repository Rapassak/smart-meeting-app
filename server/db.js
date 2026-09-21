// ============================================================================
// db.js — จุดเดียวที่ทุกไฟล์ในโปรเจกต์เรียกใช้เพื่อคุยกับฐานข้อมูล
// ----------------------------------------------------------------------------
// โครงสร้างตารางอิงตาม ER Diagram ของโปรเจกต์ (USER, ROOM, MEETING, BOOKING,
// PARTICIPANT) — เปิดไฟล์ smart_meeting_er_diagram.html เทียบดูได้
//
// เลือกใช้ฐานข้อมูล 2 แบบ สลับกันอัตโนมัติตามสภาพแวดล้อม:
//   - ไม่ได้ตั้งค่า TURSO_DATABASE_URL (ปกติตอนรันในเครื่องตัวเอง)
//     -> ใช้ไฟล์ SQLite บนเครื่อง (server/db-drivers/local-sqlite.js)
//        ไม่ต้องสมัครอะไรเลย เปิดแล้วใช้งานได้ทันที แต่ข้อมูลอยู่แค่ในเครื่องนี้
//   - ตั้งค่า TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) ไว้ (ตอน deploy ขึ้นเว็บจริง)
//     -> ใช้ฐานข้อมูลบนคลาวด์ Turso (server/db-drivers/turso-driver.js)
//        ข้อมูลอยู่ถาวร ไม่หายแม้ deploy ใหม่หรือเว็บ sleep แล้วตื่นขึ้นมา
// ดูวิธีตั้งค่า Turso ใน README.md หัวข้อ "Deploy ขึ้นเว็บให้เปิดได้จากทุกที่"
//
// โค้ดส่วนอื่นของโปรเจกต์ (ทุกไฟล์ใน routes/) ไม่ต้องสนใจว่ากำลังใช้ฐานข้อมูล
// แบบไหนอยู่ เพราะทั้งสอง driver มีหน้าตา (API) เหมือนกันทุกประการ:
//   await db.execute(sql, args)        -> { rows, columns, rowsAffected, lastInsertRowid }
//   await db.execute({ sql, args })    -> เหมือนกัน แค่เขียนอีกแบบ
// ============================================================================
const path = require('path');
const { randomSalt, hashPassword } = require('./util/password');
const { createLocalSqliteDriver } = require('./db-drivers/local-sqlite');
const { createTursoDriver } = require('./db-drivers/turso-driver');

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const usingTurso = Boolean(TURSO_URL);

const driver = usingTurso
  ? createTursoDriver(TURSO_URL, TURSO_TOKEN)
  : createLocalSqliteDriver(path.join(__dirname, '..', 'smart_meeting.db'));

if (usingTurso) {
  console.log('[db] ใช้ฐานข้อมูลคลาวด์ Turso (ข้อมูลอยู่ถาวร)');
} else {
  console.log('[db] ใช้ไฟล์ SQLite ในเครื่อง (smart_meeting.db) — ตั้งค่า TURSO_DATABASE_URL เพื่อใช้ฐานข้อมูลถาวรบนคลาวด์แทน');
}

// ----------------------------------------------------------------------------
// 0) migration: ตารางเดิม (ตอนยังไม่มีระบบสมัครสมาชิก/login จริง) ไม่มีคอลัมน์
//    username/password_hash — ถ้าเจอโครงสร้างแบบเก่า ให้ล้างตาราง users ทิ้งแล้ว
//    สร้างใหม่ตามโครงสร้างล่าสุด (ข้อมูลเดิมเป็นแค่บัญชีทดสอบตอนยังเลือก role
//    เอาเองได้ ไม่ใช่ข้อมูลผู้ใช้จริง จึงลบทิ้งได้อย่างปลอดภัย)
// ----------------------------------------------------------------------------
async function tableExists(table) {
  const result = await driver.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [table],
  });
  return result.rows.length > 0;
}

async function columnExists(table, column) {
  // ใช้ "SELECT * ... LIMIT 0" แทน PRAGMA table_info() เพราะ pragma บางตัวใช้ไม่ได้
  // ตอนต่อฐานข้อมูลผ่าน Turso จากระยะไกล — ผลลัพธ์มี columns ครบแม้ 0 แถว
  const result = await driver.execute(`SELECT * FROM ${table} LIMIT 0`);
  return result.columns.includes(column);
}

async function migrate() {
  if ((await tableExists('users')) && !(await columnExists('users', 'username'))) {
    await driver.execute('DROP TABLE IF EXISTS sessions');
    await driver.execute('DROP TABLE users');
  }
}

// ----------------------------------------------------------------------------
// 1) สร้างตาราง (ถ้ายังไม่มี)
// ----------------------------------------------------------------------------
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    user_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username       TEXT NOT NULL UNIQUE,
    password_hash  TEXT NOT NULL,
    password_salt  TEXT NOT NULL,
    name           TEXT NOT NULL,
    role           TEXT NOT NULL CHECK (role IN ('employee','organizer','admin'))
  )`,
  // session ที่เกิดขึ้นตอน login/register สำเร็จ — หน้าเว็บแนบ token นี้มาทุก
  // request เพื่อบอกว่า "ฉันคือใคร" (ดู util/session.js)
  `CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(user_id),
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS rooms (
    room_id   TEXT PRIMARY KEY,
    room_name TEXT NOT NULL,
    location  TEXT,
    capacity  INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS meetings (
    meeting_id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL,
    meeting_date        TEXT NOT NULL,
    start_time          TEXT NOT NULL,
    meeting_type        TEXT NOT NULL CHECK (meeting_type IN ('Online','Onsite','Hybrid')),
    confidential_level  TEXT NOT NULL DEFAULT 'ทั่วไป',
    meeting_link        TEXT,
    organizer_id        INTEGER REFERENCES users(user_id),
    status              TEXT NOT NULL DEFAULT 'scheduled'
                          CHECK (status IN ('scheduled','cancelled','completed'))
  )`,
  // คำขอจองห้อง แยกออกจากการประชุม ตาม ER Diagram (Meeting 1 --0..1 Booking)
  // การประชุมแบบ Online ไม่ต้องมีแถวใน Booking เลย เพราะไม่ต้องจองห้อง
  `CREATE TABLE IF NOT EXISTS bookings (
    booking_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id    INTEGER NOT NULL REFERENCES meetings(meeting_id),
    room_id       TEXT NOT NULL REFERENCES rooms(room_id),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
    requested_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS participants (
    participant_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id        INTEGER NOT NULL REFERENCES meetings(meeting_id),
    name              TEXT NOT NULL,
    check_in_status   TEXT NOT NULL DEFAULT 'not_checked_in'
                        CHECK (check_in_status IN ('not_checked_in','checked_in')),
    check_in_time     TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS notifications (
    notif_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
];

async function createSchema() {
  for (const stmt of SCHEMA_STATEMENTS) {
    await driver.execute(stmt);
  }
}

// ----------------------------------------------------------------------------
// 2) ใส่ข้อมูลตัวอย่าง (เฉพาะตอนที่ฐานข้อมูลยังว่างอยู่) เพื่อให้เปิดแอปมาแล้ว
//    เห็นข้อมูลทดสอบทันที เหมือนตอนเป็น prototype hard-code
// ----------------------------------------------------------------------------
async function seed() {
  const userCountResult = await driver.execute('SELECT COUNT(*) AS n FROM users');
  if (userCountResult.rows[0].n === 0) {
    async function seedUser(username, password, name, role) {
      const salt = randomSalt();
      await driver.execute({
        sql: 'INSERT INTO users (username, password_hash, password_salt, name, role) VALUES (?, ?, ?, ?, ?)',
        args: [username, hashPassword(password, salt), salt, name, role],
      });
    }
    // บัญชีทดสอบ (เดโม) — รหัสผ่านเดียวกันหมดเพื่อให้ทดสอบง่าย เปลี่ยน/ลบได้ตามใจ
    await seedUser('employee1', 'demo1234', 'พนักงานทดสอบ', 'employee');
    await seedUser('organizer1', 'demo1234', 'ประธาน/ผู้จัดประชุม', 'organizer');
    await seedUser('admin1', 'demo1234', 'แอดมิน', 'admin');
  }

  const roomCountResult = await driver.execute('SELECT COUNT(*) AS n FROM rooms');
  if (roomCountResult.rows[0].n === 0) {
    async function seedRoom(id, name, location, capacity) {
      await driver.execute({
        sql: 'INSERT INTO rooms (room_id, room_name, location, capacity) VALUES (?, ?, ?, ?)',
        args: [id, name, location, capacity],
      });
    }
    await seedRoom('A', 'ห้อง A', 'ชั้น 3', 12);
    await seedRoom('B', 'ห้อง B', 'ชั้น 3', 8);
    await seedRoom('C', 'ห้อง C', 'ชั้น 5', 10);
  }

  const meetingCountResult = await driver.execute('SELECT COUNT(*) AS n FROM meetings');
  if (meetingCountResult.rows[0].n === 0) {
    const organizerRow = (
      await driver.execute("SELECT user_id FROM users WHERE role='organizer'")
    ).rows[0];
    const organizerId = organizerRow ? organizerRow.user_id : null;

    async function insertMeeting(fields) {
      const result = await driver.execute({
        sql: `INSERT INTO meetings (title, meeting_date, start_time, meeting_type, confidential_level, meeting_link, organizer_id, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          fields.title, fields.meeting_date, fields.start_time, fields.meeting_type,
          fields.confidential_level, fields.meeting_link, fields.organizer_id, fields.status,
        ],
      });
      return result.lastInsertRowid;
    }
    async function insertBooking(meetingId, roomId, status) {
      await driver.execute({
        sql: 'INSERT INTO bookings (meeting_id, room_id, status) VALUES (?, ?, ?)',
        args: [meetingId, roomId, status],
      });
    }
    async function insertParticipant(meetingId, name) {
      await driver.execute({
        sql: 'INSERT INTO participants (meeting_id, name) VALUES (?, ?)',
        args: [meetingId, name],
      });
    }

    const m1 = await insertMeeting({
      title: 'ประชุมทีม Marketing', meeting_date: '2026-09-10', start_time: '09:00',
      meeting_type: 'Hybrid', confidential_level: 'ทั่วไป',
      meeting_link: 'https://meet.google.com/abc-defg', organizer_id: organizerId, status: 'scheduled',
    });
    await insertBooking(m1, 'A', 'confirmed');
    await insertParticipant(m1, 'สมชาย ใจดี');
    await insertParticipant(m1, 'วิภา ศรีสุข');

    const m2 = await insertMeeting({
      title: 'ทบทวนงบประมาณไตรมาส', meeting_date: '2026-09-10', start_time: '10:30',
      meeting_type: 'Onsite', confidential_level: 'ทั่วไป',
      meeting_link: null, organizer_id: organizerId, status: 'scheduled',
    });
    await insertBooking(m2, 'B', 'pending');
    await insertParticipant(m2, 'อรุณ พงษ์ไทย');

    const m3 = await insertMeeting({
      title: 'สัมภาษณ์ผู้สมัคร', meeting_date: '2026-09-10', start_time: '13:00',
      meeting_type: 'Online', confidential_level: 'ลับเฉพาะผู้เข้าร่วม',
      meeting_link: 'https://meet.google.com/xyz-1234', organizer_id: organizerId, status: 'scheduled',
    });
    await insertParticipant(m3, 'ฝ่ายบุคคล');

    await driver.execute({
      sql: 'INSERT INTO notifications (title, message, is_read) VALUES (?, ?, 1)',
      args: ['ยินดีต้อนรับ', 'นี่คือศูนย์การแจ้งเตือนของระบบ'],
    });
  }
}

async function init() {
  await migrate();
  await createSchema();
  await seed();
}

// เริ่มทำงานทันทีตอน require ไฟล์นี้ — server/index.js จะรอ Promise นี้ก่อน
// เปิดรับ request (กันไม่ให้มี request เข้ามาก่อนตารางถูกสร้างเสร็จ)
const ready = init();

module.exports = {
  execute: (sqlOrObj, argsMaybe) => driver.execute(sqlOrObj, argsMaybe),
  batch: (statements) => driver.batch(statements),
  ready,
  usingTurso,
};
