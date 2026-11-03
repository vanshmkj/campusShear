const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStudentId, isBatchActive } = require('../services/batches');
const { assessCard, findStudentId } = require('../services/verification');
const { loadSettings } = require('../config/settings');

const settings = {
  studentIdPattern: '^CS-(20[0-9]{2})-[0-9]{4}$',
  studentIdRegex: /^CS-(20[0-9]{2})-[0-9]{4}$/,
  batchCaptureGroup: 1,
  collegeName: 'Govt College Dharamshala'
};

test('student ID parser extracts only the configured batch capture group', () => {
  assert.equal(parseStudentId('CS-2027-0412', settings), 2027);
  assert.equal(parseStudentId('CS-1999-0412', settings), null);
  assert.equal(parseStudentId('CS-2027-41', settings), null);
  assert.equal(parseStudentId('other-2027-0412', settings), null);
});

test('batch access requires an active authorized-batches row', async () => {
  const activePool = {
    execute: async (sql, values) => {
      assert.match(sql, /FROM authorized_batches WHERE batch_year = \?/);
      assert.deepEqual(values, [2027]);
      return [[{ active: 1 }]];
    }
  };
  const inactivePool = { execute: async () => [[{ active: 0 }]] };
  assert.equal(await isBatchActive(activePool, 2027), true);
  assert.equal(await isBatchActive(inactivePool, 2027), false);
  assert.equal(await isBatchActive(activePool, null), false);
});

test('configured ID can be found inside QR payloads without accepting a different format', () => {
  assert.equal(findStudentId('https://campus.example/verify?id=CS-2027-0412', settings), 'CS-2027-0412');
  assert.equal(findStudentId('https://campus.example/verify?id=CS-2027-41', settings), null);
});

test('card checks pass only when printed ID, QR ID, and college name all match', () => {
  const result = assessCard({
    ocrText: `${settings.collegeName}\nStudent ID CS-2027-0412`,
    qrText: 'CS-2027-0412',
    submittedStudentId: 'CS-2027-0412',
    settings
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.result.printedIdMatched, true);
  assert.equal(result.result.qrIdMatched, true);
  assert.match(result.result.note, /do not prove/i);
});

test('mismatched and unreadable cards are routed to manual review', () => {
  const mismatch = assessCard({
    ocrText: 'Example University\nCS-2027-0412',
    qrText: 'CS-2026-0412',
    submittedStudentId: 'CS-2027-0412',
    settings
  });
  assert.equal(mismatch.status, 'manual_review');
  assert.equal(mismatch.result.qrIdMatched, false);

  const unreadable = assessCard({
    ocrText: '',
    qrText: null,
    submittedStudentId: 'CS-2027-0412',
    settings
  });
  assert.equal(unreadable.status, 'manual_review');
  assert.equal(unreadable.result.qrDecoded, false);
  assert.equal(unreadable.result.collegeNameMatched, false);
});

test('configuration rejects a student ID regex without its configured capture group', () => {
  const original = {
    SESSION_SECRET: process.env.SESSION_SECRET,
    MYSQL_HOST: process.env.MYSQL_HOST,
    MYSQL_USER: process.env.MYSQL_USER,
    MYSQL_DATABASE: process.env.MYSQL_DATABASE,
    COLLEGE_NAME: process.env.COLLEGE_NAME,
    STUDENT_ID_REGEX: process.env.STUDENT_ID_REGEX,
    STUDENT_ID_BATCH_GROUP: process.env.STUDENT_ID_BATCH_GROUP
  };
  Object.assign(process.env, {
    SESSION_SECRET: 'test-session-secret-with-at-least-32-characters',
    MYSQL_HOST: 'localhost',
    MYSQL_USER: 'test',
    MYSQL_DATABASE: 'test',
    COLLEGE_NAME: 'Example University',
    STUDENT_ID_REGEX: '^CS-[0-9]{8}$',
    STUDENT_ID_BATCH_GROUP: '1'
  });
  try {
    assert.throws(() => loadSettings(), /capture group/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
