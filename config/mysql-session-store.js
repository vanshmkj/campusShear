const session = require('express-session');

class MySQLSessionStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
    this.cleanupTimer = setInterval(() => {
      this.pool.execute('DELETE FROM sessions WHERE expires <= ?', [Date.now()])
        .catch((error) => console.error('Session cleanup failed:', error.message));
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sessionId, callback) {
    this.pool.execute(
      'SELECT data FROM sessions WHERE session_id = ? AND expires > ?',
      [sessionId, Date.now()]
    ).then(([rows]) => callback(null, rows.length ? JSON.parse(rows[0].data) : null))
      .catch(callback);
  }

  set(sessionId, sessionData, callback = () => {}) {
    const expires = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + 24 * 60 * 60 * 1000;
    this.pool.execute(
      `INSERT INTO sessions (session_id, expires, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sessionId, expires, JSON.stringify(sessionData)]
    ).then(() => callback(null)).catch(callback);
  }

  touch(sessionId, sessionData, callback = () => {}) {
    const expires = sessionData.cookie?.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + 24 * 60 * 60 * 1000;
    this.pool.execute('UPDATE sessions SET expires = ? WHERE session_id = ?', [expires, sessionId])
      .then(() => callback(null)).catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.pool.execute('DELETE FROM sessions WHERE session_id = ?', [sessionId])
      .then(() => callback(null)).catch(callback);
  }
}

module.exports = MySQLSessionStore;
