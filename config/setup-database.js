require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const { loadSettings } = require('./settings');
const { createPool } = require('./database');

async function setupDatabase() {
  const settings = loadSettings();
  const pool = createPool(settings);
  try {
    const schema = await fs.readFile(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    const statements = schema.split(';').map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) {
      await pool.query(statement);
    }
    console.log('Database schema created or confirmed.');
  } finally {
    await pool.end();
  }
}

setupDatabase().catch((error) => {
  console.error('Database setup failed:', error.message);
  process.exitCode = 1;
});
