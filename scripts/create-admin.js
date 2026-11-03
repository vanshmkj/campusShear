require('dotenv').config();
const bcrypt = require('bcrypt');
const { loadSettings } = require('../config/settings');
const { createPool } = require('../config/database');

async function createAdmin() {
  const name = process.env.ADMIN_NAME?.trim();
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const studentId = process.env.ADMIN_STUDENT_ID?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!name || !email || !studentId || !password) {
    throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, ADMIN_STUDENT_ID, and ADMIN_PASSWORD for this command.');
  }
  if (password.length < 12) {
    throw new Error('ADMIN_PASSWORD must contain at least 12 characters.');
  }
  const settings = loadSettings();
  if (!settings.studentIdRegex.test(studentId)) {
    throw new Error('ADMIN_STUDENT_ID does not match the configured STUDENT_ID_REGEX.');
  }

  const pool = createPool(settings);
  try {
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ? OR student_id = ?', [email, studentId]);
    if (existing.length) {
      throw new Error('An account already uses this email or student ID.');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await pool.execute(
      `INSERT INTO users
       (full_name, email, student_id, password_hash, role, approval_status, card_check_status)
       VALUES (?, ?, ?, ?, 'admin', 'approved', 'not_applicable')`,
      [name, email, studentId, passwordHash]
    );
    console.log(`Administrator account created for ${email}.`);
  } finally {
    await pool.end();
  }
}

createAdmin().catch((error) => {
  console.error('Administrator creation failed:', error.message);
  process.exitCode = 1;
});
