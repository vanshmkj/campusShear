require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { loadSettings } = require('./config/settings');
const { createPool } = require('./config/database');
const MySQLSessionStore = require('./config/mysql-session-store');
const createAuthRouter = require('./routes/auth');
const createResourcesRouter = require('./routes/resources');
const createAdminRouter = require('./routes/admin');

async function createApp() {
  const settings = loadSettings();
  settings.privateUploadDir = path.resolve(settings.privateUploadDir);
  await fs.mkdir(settings.privateUploadDir, { recursive: true, mode: 0o700 });
  const pool = createPool(settings);
  await pool.query('SELECT 1');
  const app = express();
  app.locals.settings = settings;
  app.locals.pool = pool;
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"]
      }
    }
  }));
  app.use(express.json({ limit: '32kb' }));
  app.use(session({
    name: 'campusshare.sid',
    secret: settings.sessionSecret,
    store: new MySQLSessionStore(pool),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60 * 1000
    }
  }));

  app.get('/api/csrf', (req, res) => {
    if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
    res.set('Cache-Control', 'no-store');
    res.json({ csrfToken: req.session.csrfToken });
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('Origin') && req.get('Origin') !== settings.appOrigin) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    const token = req.get('X-CSRF-Token');
    const expected = req.session.csrfToken;
    if (!token || !expected) return res.status(403).json({ error: 'CSRF token is missing. Refresh the page and try again.' });
    const supplied = Buffer.from(token);
    const valid = supplied.length === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(supplied, Buffer.from(expected));
    if (!valid) return res.status(403).json({ error: 'CSRF token is invalid. Refresh the page and try again.' });
    next();
  });
  app.use('/api', (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS', 'DELETE'].includes(req.method)) return next();
    if (req.path === '/auth/register') {
      if (!req.is('multipart/form-data')) {
        return res.status(415).json({ error: 'Registration must use multipart form data with an ID-card image.' });
      }
      return next();
    }
    if (!req.is('application/json')) {
      return res.status(415).json({ error: 'Send state-changing API data as JSON.' });
    }
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Request body must be a JSON object.' });
    }
    next();
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Please wait and try again.' }
  });
  app.use('/api/auth', createAuthRouter(pool, settings, authLimiter));
  app.use('/api/resources', createResourcesRouter(pool));
  app.use('/api/admin', createAdminRouter(pool, settings));
  app.use(express.static(path.join(__dirname, 'public'), {
    dotfiles: 'deny',
    index: 'index.html',
    maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found.' }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: 'Request body must be valid JSON.' });
    }
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'ID-card image must be 5 MB or smaller.' });
    if (error.code === 'INVALID_UPLOAD') return res.status(400).json({ error: error.message });
    if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.name === 'MulterError') {
      return res.status(400).json({ error: error.message });
    }
    if (error.message?.startsWith('Upload a JPEG') || error.message?.startsWith('The uploaded file')) {
      return res.status(400).json({ error: error.message });
    }
    console.error('Request failed:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again later.' });
  });
  return app;
}

if (require.main === module) {
  createApp().then((app) => {
    const server = app.listen(app.locals.settings.port, () => {
      console.log(`CampusShare is listening on port ${app.locals.settings.port}`);
    });
    const shutdown = async () => {
      server.close(async () => {
        await app.locals.pool.end();
        process.exit(0);
      });
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch((error) => {
    console.error('CampusShare could not start:', error.message);
    process.exitCode = 1;
  });
}

module.exports = { createApp };
