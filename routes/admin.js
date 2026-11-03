const express = require('express');
const path = require('node:path');
const { requireApprovedStudent, requireAdmin } = require('../middleware/auth');

function createAdminRouter(pool, settings) {
  const router = express.Router();
  router.use(requireApprovedStudent(pool, { allowAdmin: true }), requireAdmin);

  router.get('/registrations', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT id, full_name, email, student_id, batch_year, card_check_status,
                card_check_result, created_at
         FROM users WHERE role = 'student' AND approval_status = 'pending'
         ORDER BY created_at ASC`
      );
      res.json({ registrations: rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/registrations/:id(\\d+)/id-card', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        "SELECT id_card_path FROM users WHERE id = ? AND role = 'student'",
        [req.params.id]
      );
      if (!rows[0]?.id_card_path) return res.status(404).json({ error: 'ID-card image not found.' });
      const filename = path.basename(rows[0].id_card_path);
      res.sendFile(filename, { root: settings.privateUploadDir, headers: { 'Cache-Control': 'private, no-store' } }, (error) => {
        if (error && !res.headersSent) next(error);
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/registrations/:id(\\d+)', async (req, res, next) => {
    const status = req.body.status;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Registration status must be approved or rejected.' });
    }
    try {
      const [result] = await pool.execute(
        "UPDATE users SET approval_status = ? WHERE id = ? AND role = 'student' AND approval_status = 'pending'",
        [status, req.params.id]
      );
      if (!result.affectedRows) return res.status(409).json({ error: 'Registration was not found or has already been reviewed.' });
      res.json({ message: `Student registration ${status}.` });
    } catch (error) {
      next(error);
    }
  });

  router.get('/batches', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT b.batch_year, b.active, b.updated_at, COUNT(u.id) AS student_count
         FROM authorized_batches b LEFT JOIN users u ON u.batch_year = b.batch_year
         GROUP BY b.batch_year, b.active, b.updated_at ORDER BY b.batch_year DESC`
      );
      res.json({ batches: rows });
    } catch (error) {
      next(error);
    }
  });

  router.put('/batches/:year(\\d{4})', async (req, res, next) => {
    if (typeof req.body.active !== 'boolean') {
      return res.status(400).json({ error: 'Batch active status must be true or false.' });
    }
    const year = Number(req.params.year);
    if (year < 1900 || year > 2200) {
      return res.status(400).json({ error: 'Batch year must be between 1900 and 2200.' });
    }
    try {
      await pool.execute(
        `INSERT INTO authorized_batches (batch_year, active) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE active = VALUES(active)`,
        [year, req.body.active]
      );
      res.json({ message: `Batch ${req.params.year} ${req.body.active ? 'activated' : 'deactivated'}.` });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = createAdminRouter;
