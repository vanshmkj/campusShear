const express = require('express');
const bcrypt = require('bcrypt');
const multer = require('multer');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { parseStudentId, isBatchActive } = require('../services/batches');
const { verifyStudentCard } = require('../services/verification');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FILE_EXTENSIONS = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, callback) => callback(null, req.app.locals.settings.privateUploadDir),
    filename: (req, file, callback) => callback(null, `${crypto.randomUUID()}${FILE_EXTENSIONS[file.mimetype]}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, callback) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      return callback(new Error('Upload a JPEG, PNG, or WebP student ID image.'));
    }
    callback(null, true);
  }
});

function createAuthRouter(pool, settings, authLimiter) {
  const router = express.Router();

  router.post('/register', authLimiter, upload.single('idCard'), async (req, res, next) => {
    let uploadedPath = req.file?.path;
    try {
      const fullName = typeof req.body.fullName === 'string' ? req.body.fullName.trim() : '';
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const studentId = typeof req.body.studentId === 'string' ? req.body.studentId.trim() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const confirmPassword = typeof req.body.confirmPassword === 'string' ? req.body.confirmPassword : '';
      if (!fullName || fullName.length > 120 || !email || email.length > 254 || !EMAIL_PATTERN.test(email) ||
          !studentId || studentId.length > 80 || !password || !confirmPassword || !req.file) {
        return res.status(400).json({ error: 'Complete every field with a valid name, college email, student ID, password, and ID card image.' });
      }
      if (settings.collegeEmailDomain && email.split('@')[1] !== settings.collegeEmailDomain) {
        return res.status(400).json({ error: `Use your @${settings.collegeEmailDomain} college email address.` });
      }
      if (password.length < 10 || password.length > 128) {
        return res.status(400).json({ error: 'Password must be between 10 and 128 characters.' });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ error: 'Passwords do not match.' });
      }
      const batchYear = parseStudentId(studentId, settings);
      if (!batchYear) {
        return res.status(400).json({ error: 'Student ID does not match the configured format.' });
      }
      if (!(await isBatchActive(pool, batchYear))) {
        return res.status(403).json({ error: `The ${batchYear} batch is not currently authorized to register.` });
      }
      const [duplicates] = await pool.execute(
        'SELECT email, student_id FROM users WHERE email = ? OR student_id = ?',
        [email, studentId]
      );
      if (duplicates.some((row) => row.email === email)) {
        return res.status(409).json({ error: 'An account already exists for this college email.' });
      }
      if (duplicates.some((row) => row.student_id === studentId)) {
        return res.status(409).json({ error: 'An account already exists for this student ID.' });
      }

      const verification = await verifyStudentCard({
        filePath: uploadedPath,
        submittedMimeType: req.file.mimetype,
        submittedStudentId: studentId,
        settings
      });
      const passwordHash = await bcrypt.hash(password, 12);
      await pool.execute(
        `INSERT INTO users
         (full_name, email, student_id, password_hash, batch_year, approval_status,
          card_check_status, card_check_result, id_card_path)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [
          fullName,
          email,
          studentId,
          passwordHash,
          batchYear,
          verification.status,
          JSON.stringify(verification.result),
          path.basename(uploadedPath)
        ]
      );
      uploadedPath = null;
      res.status(201).json({
        message: 'Registration submitted. Your account is pending administrator approval.',
        approvalStatus: 'pending',
        cardCheckStatus: verification.status
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'An account already exists for that email or student ID.' });
      }
      next(error);
    } finally {
      if (uploadedPath) await fs.unlink(uploadedPath).catch((unlinkError) => {
        console.error('Unable to remove unclaimed ID-card upload:', unlinkError.message);
      });
    }
  });

  router.post('/login', authLimiter, async (req, res, next) => {
    try {
      const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      if (!email || !password || email.length > 254) {
        return res.status(400).json({ error: 'Enter your email and password.' });
      }
      const [rows] = await pool.execute(
        `SELECT id, full_name, email, student_id, password_hash, role, batch_year, approval_status,
                card_check_status, card_check_result
         FROM users WHERE email = ?`,
        [email]
      );
      const user = rows[0];
      const passwordMatches = await bcrypt.compare(password, user?.password_hash || '$2b$12$C6UzMDM.H6dfI/f/IKcEe.8UVp6GpzL1mPTQjS6f8Fk9S46ZCknN6');
      if (!user || !passwordMatches) {
        return res.status(401).json({ error: 'Email or password is incorrect.' });
      }
      if (user.role !== 'admin' && !(await isBatchActive(pool, user.batch_year))) {
        return res.status(403).json({ error: 'Your student batch is not currently authorized. Contact an administrator.' });
      }

      await new Promise((resolve, reject) => req.session.regenerate((error) => error ? reject(error) : resolve()));
      req.session.userId = user.id;
      res.json({
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          studentId: user.student_id,
          role: user.role,
          batchYear: user.batch_year,
          approvalStatus: user.approval_status,
          cardCheckStatus: user.card_check_status,
          cardCheckResult: user.card_check_result
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', async (req, res, next) => {
    req.session.destroy((error) => {
      if (error) return next(error);
      res.clearCookie('campusshare.sid', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
      res.status(204).end();
    });
  });

  router.get('/me', async (req, res, next) => {
    if (!req.session.userId) return res.json({ user: null });
    try {
      const [rows] = await pool.execute(
        `SELECT id, full_name, email, student_id, role, batch_year, approval_status,
                card_check_status, card_check_result FROM users WHERE id = ?`,
        [req.session.userId]
      );
      if (!rows[0]) return res.json({ user: null });
      const user = rows[0];
      res.json({
        user: {
          id: user.id,
          fullName: user.full_name,
          email: user.email,
          studentId: user.student_id,
          role: user.role,
          batchYear: user.batch_year,
          approvalStatus: user.approval_status,
          cardCheckStatus: user.card_check_status,
          cardCheckResult: user.card_check_result
        }
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createAuthRouter;
