const express = require('express');
const { requireApprovedStudent } = require('../middleware/auth');

const CATEGORIES = new Set(['Books', 'Electronics', 'Lab equipment', 'Sports', 'Other']);
const RESOURCE_FIELDS = new Set(['title', 'description', 'category', 'availability']);

function createResourcesRouter(pool) {
  const router = express.Router();
  const approvedStudent = requireApprovedStudent(pool);

  router.get('/', async (req, res, next) => {
    try {
      const search = (req.query.search || '').toString().trim().slice(0, 100);
      const category = (req.query.category || '').toString().trim();
      const conditions = ["r.availability = 'available'"];
      const params = [];
      if (search) {
        conditions.push('(r.title LIKE ? OR r.description LIKE ? OR r.category LIKE ?)');
        const term = `%${search}%`;
        params.push(term, term, term);
      }
      if (category && CATEGORIES.has(category)) {
        conditions.push('r.category = ?');
        params.push(category);
      }
      const [rows] = await pool.execute(
        `SELECT r.id, r.title, r.description, r.category, r.availability, r.created_at,
                u.full_name AS owner_name
         FROM resources r JOIN users u ON u.id = r.owner_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY r.created_at DESC LIMIT 100`,
        params
      );
      res.json({ resources: rows });
    } catch (error) {
      next(error);
    }
  });

  router.get('/:id(\\d+)', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT r.id, r.title, r.description, r.category, r.availability, r.created_at,
                u.full_name AS owner_name
         FROM resources r JOIN users u ON u.id = r.owner_id
         WHERE r.id = ? AND r.availability = 'available'`,
        [req.params.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Resource not found.' });
      res.json({ resource: rows[0] });
    } catch (error) {
      next(error);
    }
  });

  router.use(approvedStudent);

  router.get('/mine', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        'SELECT id, title, description, category, availability, created_at FROM resources WHERE owner_id = ? ORDER BY created_at DESC',
        [req.user.id]
      );
      res.json({ resources: rows });
    } catch (error) {
      next(error);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const resource = validateResource(req.body);
      if (resource.error) return res.status(400).json({ error: resource.error });
      const [result] = await pool.execute(
        'INSERT INTO resources (owner_id, title, description, category, availability) VALUES (?, ?, ?, ?, ?)',
        [req.user.id, resource.title, resource.description, resource.category, resource.availability]
      );
      res.status(201).json({ id: result.insertId, message: 'Your resource listing is live.' });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/:id(\\d+)', async (req, res, next) => {
    let connection;
    try {
      const keys = Object.keys(req.body);
      if (!keys.length || keys.some((key) => !RESOURCE_FIELDS.has(key))) {
        return res.status(400).json({ error: 'Provide only title, description, category, or availability fields.' });
      }
      const current = {};
      if (req.body.title !== undefined) current.title = req.body.title;
      if (req.body.description !== undefined) current.description = req.body.description;
      if (req.body.category !== undefined) current.category = req.body.category;
      if (req.body.availability !== undefined) current.availability = req.body.availability;
      const resource = validateResource(current, true);
      if (resource.error) return res.status(400).json({ error: resource.error });
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [rows] = await connection.execute(
        'SELECT id FROM resources WHERE id = ? AND owner_id = ? FOR UPDATE',
        [req.params.id, req.user.id]
      );
      if (!rows.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'Resource not found.' });
      }
      if (resource.availability === 'available') {
        const [activeLoans] = await connection.execute(
          "SELECT id FROM borrow_requests WHERE resource_id = ? AND status = 'approved' FOR UPDATE",
          [req.params.id]
        );
        if (activeLoans.length) {
          await connection.rollback();
          return res.status(409).json({ error: 'This resource cannot be made available until its active borrowing is returned.' });
        }
      }
      const assignments = Object.keys(resource).map((field) => `${field} = ?`);
      const values = Object.values(resource);
      values.push(req.params.id, req.user.id);
      await connection.execute(
        `UPDATE resources SET ${assignments.join(', ')} WHERE id = ? AND owner_id = ?`,
        values
      );
      await connection.commit();
      res.json({ message: 'Resource listing updated.' });
    } catch (error) {
      if (connection) await rollbackTransaction(connection);
      next(error);
    } finally {
      connection?.release();
    }
  });

  router.delete('/:id(\\d+)', async (req, res, next) => {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [resources] = await connection.execute(
        'SELECT id FROM resources WHERE id = ? AND owner_id = ? FOR UPDATE',
        [req.params.id, req.user.id]
      );
      if (!resources.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'Resource not found.' });
      }
      const [activeLoans] = await connection.execute(
        "SELECT id FROM borrow_requests WHERE resource_id = ? AND status = 'approved' FOR UPDATE",
        [req.params.id]
      );
      if (activeLoans.length) {
        await connection.rollback();
        return res.status(409).json({ error: 'Return the resource before deleting this listing.' });
      }
      await connection.execute('DELETE FROM resources WHERE id = ?', [req.params.id]);
      await connection.commit();
      res.status(204).end();
    } catch (error) {
      if (connection) await rollbackTransaction(connection);
      next(error);
    } finally {
      connection?.release();
    }
  });

  router.get('/requests', async (req, res, next) => {
    try {
      const [rows] = await pool.execute(
        `SELECT br.id, br.resource_id, br.borrower_id, br.status, br.message, br.created_at,
                r.title AS resource_title, r.owner_id, borrower.full_name AS borrower_name,
                owner.full_name AS owner_name
         FROM borrow_requests br
         JOIN resources r ON r.id = br.resource_id
         JOIN users borrower ON borrower.id = br.borrower_id
         JOIN users owner ON owner.id = r.owner_id
         WHERE br.borrower_id = ? OR r.owner_id = ?
         ORDER BY br.created_at DESC LIMIT 100`,
        [req.user.id, req.user.id]
      );
      res.json({ requests: rows });
    } catch (error) {
      next(error);
    }
  });

  router.post('/:id(\\d+)/requests', async (req, res, next) => {
    const message = req.body.message === undefined
      ? ''
      : typeof req.body.message === 'string' ? req.body.message.trim() : null;
    if (message === null) return res.status(400).json({ error: 'Request message must be plain text.' });
    if (message.length > 500) return res.status(400).json({ error: 'Request message must be 500 characters or fewer.' });
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [resources] = await connection.execute(
        'SELECT id, owner_id, availability FROM resources WHERE id = ? FOR UPDATE',
        [req.params.id]
      );
      const resource = resources[0];
      if (!resource || resource.availability !== 'available') {
        await connection.rollback();
        return res.status(409).json({ error: 'This resource is not currently available.' });
      }
      if (String(resource.owner_id) === String(req.user.id)) {
        await connection.rollback();
        return res.status(400).json({ error: 'You cannot request to borrow your own resource.' });
      }
      const [existing] = await connection.execute(
        "SELECT id FROM borrow_requests WHERE resource_id = ? AND borrower_id = ? AND status = 'pending'",
        [req.params.id, req.user.id]
      );
      if (existing.length) {
        await connection.rollback();
        return res.status(409).json({ error: 'You already have a pending request for this resource.' });
      }
      const [result] = await connection.execute(
        'INSERT INTO borrow_requests (resource_id, borrower_id, message) VALUES (?, ?, ?)',
        [req.params.id, req.user.id, message]
      );
      await connection.commit();
      res.status(201).json({ id: result.insertId, message: 'Borrowing request sent to the resource owner.' });
    } catch (error) {
      if (connection) await rollbackTransaction(connection);
      next(error);
    } finally {
      connection?.release();
    }
  });

  router.patch('/requests/:id(\\d+)', async (req, res, next) => {
    const decision = req.body.status;
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ error: 'Request status must be approved or rejected.' });
    }
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [references] = await connection.execute(
        'SELECT resource_id FROM borrow_requests WHERE id = ?',
        [req.params.id]
      );
      if (!references.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'Borrowing request not found.' });
      }
      const resourceId = references[0].resource_id;
      const [resources] = await connection.execute(
        'SELECT owner_id, availability FROM resources WHERE id = ? FOR UPDATE',
        [resourceId]
      );
      const resource = resources[0];
      const [requests] = await connection.execute(
        'SELECT id, status, resource_id FROM borrow_requests WHERE id = ? FOR UPDATE',
        [req.params.id]
      );
      const request = requests[0];
      if (!request || !resource || String(resource.owner_id) !== String(req.user.id)) {
        await connection.rollback();
        return res.status(404).json({ error: 'Borrowing request not found.' });
      }
      if (request.status !== 'pending') {
        await connection.rollback();
        return res.status(409).json({ error: 'This request has already been handled.' });
      }
      if (decision === 'approved' && resource.availability !== 'available') {
        await connection.rollback();
        return res.status(409).json({ error: 'This resource is no longer available.' });
      }
      await connection.execute('UPDATE borrow_requests SET status = ? WHERE id = ?', [decision, request.id]);
      if (decision === 'approved') {
        await connection.execute("UPDATE resources SET availability = 'unavailable' WHERE id = ?", [request.resource_id]);
        await connection.execute(
          "UPDATE borrow_requests SET status = 'rejected' WHERE resource_id = ? AND id <> ? AND status = 'pending'",
          [request.resource_id, request.id]
        );
      }
      await connection.commit();
      res.json({ message: `Borrowing request ${decision}.` });
    } catch (error) {
      if (connection) await rollbackTransaction(connection);
      next(error);
    } finally {
      connection?.release();
    }
  });

  router.post('/requests/:id(\\d+)/return', async (req, res, next) => {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      const [references] = await connection.execute(
        'SELECT resource_id FROM borrow_requests WHERE id = ?',
        [req.params.id]
      );
      if (!references.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'Borrowing request not found.' });
      }
      const resourceId = references[0].resource_id;
      const [resources] = await connection.execute(
        'SELECT owner_id FROM resources WHERE id = ? FOR UPDATE',
        [resourceId]
      );
      const [requests] = await connection.execute(
        'SELECT id, status, resource_id, borrower_id FROM borrow_requests WHERE id = ? FOR UPDATE',
        [req.params.id]
      );
      const request = requests[0];
      const resource = resources[0];
      const isParticipant = request && resource && (
        String(resource.owner_id) === String(req.user.id) ||
        String(request.borrower_id) === String(req.user.id)
      );
      if (!isParticipant) {
        await connection.rollback();
        return res.status(404).json({ error: 'Borrowing request not found.' });
      }
      if (request.status !== 'approved') {
        await connection.rollback();
        return res.status(409).json({ error: 'Only an active borrowing can be marked returned.' });
      }
      await connection.execute("UPDATE borrow_requests SET status = 'returned' WHERE id = ?", [request.id]);
      await connection.execute("UPDATE resources SET availability = 'available' WHERE id = ?", [request.resource_id]);
      await connection.commit();
      res.json({ message: 'Resource marked as returned and available again.' });
    } catch (error) {
      if (connection) await rollbackTransaction(connection);
      next(error);
    } finally {
      connection?.release();
    }
  });

  return router;
}

function validateResource(body, partial = false) {
  const result = {};
  const title = typeof body.title === 'string' ? body.title.trim() : undefined;
  const description = typeof body.description === 'string' ? body.description.trim() : undefined;
  const category = typeof body.category === 'string' ? body.category.trim() : undefined;
  const availability = body.availability;
  if ((!partial || body.title !== undefined) && (title === undefined || !title || title.length > 160)) {
    return { error: 'Title is required and must be 160 characters or fewer.' };
  }
  if ((!partial || body.description !== undefined) && (description === undefined || !description || description.length > 5000)) {
    return { error: 'Description is required and must be 5,000 characters or fewer.' };
  }
  if ((!partial || body.category !== undefined) && !CATEGORIES.has(category)) {
    return { error: 'Choose a valid resource category.' };
  }
  if (availability !== undefined && !['available', 'unavailable'].includes(availability)) {
    return { error: 'Availability must be available or unavailable.' };
  }
  if (title !== undefined && body.title !== undefined) result.title = title;
  if (description !== undefined && body.description !== undefined) result.description = description;
  if (category !== undefined && body.category !== undefined) result.category = category;
  if (availability !== undefined) result.availability = availability;
  return result;
}

async function rollbackTransaction(connection) {
  try {
    await connection.rollback();
  } catch (error) {
    console.error('Unable to roll back database transaction:', error.message);
  }
}

module.exports = createResourcesRouter;
