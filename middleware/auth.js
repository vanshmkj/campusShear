const { isBatchActive } = require('../services/batches');

function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Please log in to continue.' });
  }
  next();
}

function requireApprovedStudent(pool, { allowAdmin = false } = {}) {
  return async (req, res, next) => {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ error: 'Please log in to continue.' });
      }
      const [rows] = await pool.execute(
        'SELECT id, full_name, email, student_id, role, batch_year, approval_status FROM users WHERE id = ?',
        [req.session.userId]
      );
      const user = rows[0];
      if (!user) {
        return req.session.destroy((destroyError) => {
          if (destroyError) return next(destroyError);
          res.status(401).json({ error: 'Your session is no longer valid. Please log in again.' });
        });
      }
      if (user.role === 'admin') {
        if (!allowAdmin) return res.status(403).json({ error: 'Only approved students can use resource-sharing features.' });
        req.user = user;
        return next();
      }
      if (user.approval_status !== 'approved') {
        return res.status(403).json({ error: `Your account is ${user.approval_status}. Resource-sharing access is unavailable until approval.` });
      }
      if (!(await isBatchActive(pool, user.batch_year))) {
        return res.status(403).json({ error: 'Your student batch is not currently authorized.' });
      }
      req.user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Administrator access is required.' });
  }
  next();
}

module.exports = { requireLogin, requireApprovedStudent, requireAdmin };
