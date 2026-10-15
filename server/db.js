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

  // ----------------------------------------------------------------------------
  // 0b) migration (เพิ่มระบบจัดการผู้ใช้/เช็คอินด้วย QR จริง): เดิมมี 3 บทบาท
  //    (employee/organizer/admin) ตอนนี้เหลือ 2 บทบาท (employee/admin) —
  //    บัญชีเก่าที่เป็น organizer แปลงเป็น employee ให้อัตโนมัติ (ไม่ลบบัญชีทิ้ง
  //    แค่เปลี่ยนค่า role) และเพิ่มคอลัมน์ใหม่แบบไม่ทำลายข้อมูลเดิม (ALTER TABLE
  //    ADD COLUMN เฉยๆ ไม่ใช่ DROP/CREATE ใหม่ จึงไม่กระทบข้อมูลจริงที่มีอยู่แล้ว)
  // ----------------------------------------------------------------------------
  if (await tableExists('users')) {
    await driver.execute("UPDATE users SET role = 'employee' WHERE role = 'organizer'");
  }
  if ((await tableExists('meetings')) && !(await columnExists('meetings', 'chair_name'))) {
    await driver.execute("ALTER TABLE meetings ADD COLUMN chair_name TEXT DEFAULT ''");
  }
  if ((await tableExists('participants')) && !(await columnExists('participants', 'position'))) {
    await driver.execute("ALTER TABLE participants ADD COLUMN position TEXT DEFAULT ''");
  }

  // ----------------------------------------------------------------------------
  // 0c) migration (เพิ่มระบบแจ้งเตือน/รายงานประชุม/ลืมรหัสผ่าน): เพิ่มคอลัมน์ใหม่
  //    แบบไม่ทำลายข้อมูลเดิม + สร้างตารางใหม่ (ไม่กระทบตารางเดิมที่มีอยู่แล้ว)
  //   - meetings.reminder_sent: กันแจ้งเตือน "ใกล้ถึงเวลาประชุม" ซ้ำ (ดู util/meeting-lifecycle.js)
  //   - notifications.user_id: NULL = แจ้งเตือนกว้างๆ (เหมือนเดิม), มีค่า = แจ้งเตือน
  //     เฉพาะคนคนนั้น (เช่น เตือนประชุม/เตือนให้ลงรายงาน จะส่งถึงแค่เจ้าของการประชุม)
  // ----------------------------------------------------------------------------
  if ((await tableExists('meetings')) && !(await columnExists('meetings', 'reminder_sent'))) {
    await driver.execute('ALTER TABLE meetings ADD COLUMN reminder_sent INTEGER NOT NULL DEFAULT 0');
  }
  if ((await tableExists('notifications')) && !(await columnExists('notifications', 'user_id'))) {
    await driver.execute('ALTER TABLE notifications ADD COLUMN user_id INTEGER REFERENCES users(user_id)');
  }

  // ----------------------------------------------------------------------------
  // 0d) migration (รอบ 2: เวลาจบประชุม, ระดับการเข้าถึงชั้นความลับ, อนุมัติบัญชีใหม่):
  //   - meetings.end_time: เวลาจบจริง (ก่อนหน้านี้สมมติว่าประชุม 2 ชม. เสมอ —
  //     ดู util/meeting-lifecycle.js) ปล่อยเป็น NULL ได้สำหรับการประชุมเก่าที่มีอยู่
  //     ก่อนฟีเจอร์นี้ (ระบบจะ fallback ไปใช้เวลาสมมติแบบเดิมให้อัตโนมัติ)
  //   - users.access_level: ระดับการเข้าถึงชั้นความลับของบัญชี (1=สูงสุดเห็นหมด,
  //     2=เห็นถึง "ลับ", 3=เห็นแค่ "ทั่วไป") บัญชีเดิมที่มีอยู่ก่อนฟีเจอร์นี้ set
  //     เป็น 1 (เห็นทุกอย่างเหมือนเดิม) กันไม่ให้ถูกบล็อกมองไม่เห็นข้อมูลที่เคยเห็นได้
  //   - users.account_status: 'pending' (รอแอดมินอนุมัติ) / 'active' / 'rejected'
  //     บัญชีเดิมทั้งหมด set เป็น 'active' (ใช้งานได้ต่อเนื่องเหมือนเดิม ไม่ต้องรอ
  //     อนุมัติย้อนหลัง) — มีผลเฉพาะบัญชีที่สมัครเองใหม่หลังจากนี้เท่านั้น
  //   - normalize ค่าระดับความลับเก่า "ลับเฉพาะผู้เข้าร่วม" ให้เป็นค่าใหม่ 1 ใน 3
  //     ระดับคงที่ (ทั่วไป/ลับ/ลับมาก) เพื่อให้ตรรกะสิทธิ์เข้าถึงทำงานถูกต้อง
  // ----------------------------------------------------------------------------
  if ((await tableExists('meetings')) && !(await columnExists('meetings', 'end_time'))) {
    await driver.execute('ALTER TABLE meetings ADD COLUMN end_time TEXT');
  }
  if ((await tableExists('users')) && !(await columnExists('users', 'access_level'))) {
    await driver.execute('ALTER TABLE users ADD COLUMN access_level INTEGER NOT NULL DEFAULT 1');
  }
  if ((await tableExists('users')) && !(await columnExists('users', 'account_status'))) {
    await driver.execute("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'");
  }
  if (await tableExists('meetings')) {
    await driver.execute("UPDATE meetings SET confidential_level = 'ลับ' WHERE confidential_level = 'ลับเฉพาะผู้เข้าร่วม'");
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
    role           TEXT NOT NULL CHECK (role IN ('employee','organizer','admin')),
    access_level   INTEGER NOT NULL DEFAULT 1,
    account_status TEXT NOT NULL DEFAULT 'active' CHECK (account_status IN ('pending','active','rejected'))
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
    end_time            TEXT,
    meeting_type        TEXT NOT NULL CHECK (meeting_type IN ('Online','Onsite','Hybrid')),
    confidential_level  TEXT NOT NULL DEFAULT 'ทั่วไป',
    meeting_link        TEXT,
    organizer_id        INTEGER REFERENCES users(user_id),
    chair_name          TEXT DEFAULT '',
    reminder_sent       INTEGER NOT NULL DEFAULT 0,
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
    position          TEXT DEFAULT '',
    check_in_status   TEXT NOT NULL DEFAULT 'not_checked_in'
                        CHECK (check_in_status IN ('not_checked_in','checked_in')),
    check_in_time     TEXT
  )`,
  // user_id: NULL = แจ้งเตือนกว้างๆ ให้ทุกคนที่ login อยู่เห็น (เหมือนเดิม),
  // มีค่า = แจ้งเตือนเฉพาะคนคนนั้น (เช่น เตือนใกล้ถึงเวลาประชุม/เตือนลงรายงาน)
  `CREATE TABLE IF NOT EXISTS notifications (
    notif_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    message     TEXT NOT NULL,
    user_id     INTEGER REFERENCES users(user_id),
    is_read     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // คำขอ "ลืมรหัสผ่าน" — ไม่มีระบบอีเมล จึงให้พนักงานกดขอแล้วแอดมินเป็นคนตั้ง
  // รหัสผ่านใหม่ให้แทน (ดู routes/password-reset.js) สถานะ pending -> resolved
  `CREATE TABLE IF NOT EXISTS password_reset_requests (
    request_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL REFERENCES users(user_id),
    status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved')),
    requested_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at   TEXT,
    resolved_by   INTEGER REFERENCES users(user_id)
  )`,
  // รายงานสรุปผลการประชุม — 1 การประชุม มีได้ 1 รายงาน (UNIQUE meeting_id) แก้ไข
  // ซ้ำได้เรื่อยๆ (upsert ใน routes/reports.js) — มีแถวในตารางนี้ = "ลงรายงานแล้ว"
  `CREATE TABLE IF NOT EXISTS meeting_reports (
    report_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id    INTEGER NOT NULL UNIQUE REFERENCES meetings(meeting_id),
    summary       TEXT NOT NULL DEFAULT '',
    resolutions   TEXT NOT NULL DEFAULT '',
    action_items  TEXT NOT NULL DEFAULT '',
    created_by    INTEGER REFERENCES users(user_id),
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  // บันทึกว่า "ฉัน" (user_id) ปิด/ล้างการแจ้งเตือนแถวไหนไปแล้วบ้าง — ไม่ลบแถวจริง
  // ในตาราง notifications ทิ้ง เพราะแจ้งเตือนกว้างๆ (user_id ของ notifications เป็น
  // NULL) ยังต้องโชว์ให้คนอื่นที่ยังไม่เห็นอยู่ด้วย การปิด/ล้างของแต่ละคนจึงต้อง
  // แยกเก็บเป็นรายคน ไม่กระทบคนอื่น
  `CREATE TABLE IF NOT EXISTS notification_dismissals (
    notif_id      INTEGER NOT NULL REFERENCES notifications(notif_id),
    user_id       INTEGER NOT NULL REFERENCES users(user_id),
    dismissed_at  TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (notif_id, user_id)
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
    // (เหลือ 2 บทบาทแล้ว: employee / admin — "organizer1" เก็บชื่อผู้ใช้เดิมไว้
    // เพื่อความคุ้นเคย แต่ตอนนี้เป็นบทบาทพนักงานเหมือนกับ employee1)
    await seedUser('employee1', 'demo1234', 'พนักงานทดสอบ', 'employee');
    await seedUser('organizer1', 'demo1234', 'พนักงานทดสอบ 2', 'employee');
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
    const creatorRow = (
      await driver.execute("SELECT user_id FROM users WHERE role='employee' ORDER BY user_id LIMIT 1")
    ).rows[0];
    const creatorId = creatorRow ? creatorRow.user_id : null;
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD ของวันที่รันจริง ไม่ตายตัว

    async function insertMeeting(fields) {
      const result = await driver.execute({
        sql: `INSERT INTO meetings (title, meeting_date, start_time, meeting_type, confidential_level, meeting_link, organizer_id, chair_name, status)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          fields.title, fields.meeting_date, fields.start_time, fields.meeting_type,
          fields.confidential_level, fields.meeting_link, fields.organizer_id, fields.chair_name, fields.status,
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
    async function insertParticipant(meetingId, name, position) {
      await driver.execute({
        sql: `INSERT INTO participants (meeting_id, name, position, check_in_status, check_in_time)
              VALUES (?, ?, ?, 'checked_in', datetime('now'))`,
        args: [meetingId, name, position || ''],
      });
    }

    const m1 = await insertMeeting({
      title: 'ประชุมทีม Marketing', meeting_date: today, start_time: '09:00',
      meeting_type: 'Hybrid', confidential_level: 'ทั่วไป',
      meeting_link: 'https://meet.google.com/abc-defg', organizer_id: creatorId,
      chair_name: 'ประธาน ฝ่ายการตลาด', status: 'scheduled',
    });
    await insertBooking(m1, 'A', 'confirmed');
    await insertParticipant(m1, 'สมชาย ใจดี', 'นักการตลาด');
    await insertParticipant(m1, 'วิภา ศรีสุข', 'กราฟิกดีไซเนอร์');

    const m2 = await insertMeeting({
      title: 'ทบทวนงบประมาณไตรมาส', meeting_date: today, start_time: '10:30',
      meeting_type: 'Onsite', confidential_level: 'ทั่วไป',
      meeting_link: null, organizer_id: creatorId,
      chair_name: 'ผู้จัดการฝ่ายการเงิน', status: 'scheduled',
    });
    await insertBooking(m2, 'B', 'pending');
    await insertParticipant(m2, 'อรุณ พงษ์ไทย', 'นักบัญชี');

    const m3 = await insertMeeting({
      title: 'สัมภาษณ์ผู้สมัคร', meeting_date: today, start_time: '13:00',
      meeting_type: 'Online', confidential_level: 'ลับ',
      meeting_link: 'https://meet.google.com/xyz-1234', organizer_id: creatorId,
      chair_name: 'หัวหน้าฝ่ายบุคคล', status: 'scheduled',
    });
    await insertParticipant(m3, 'ฝ่ายบุคคล', 'เจ้าหน้าที่สรรหา');

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
