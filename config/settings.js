function loadSettings() {
  const required = [
    'SESSION_SECRET',
    'MYSQL_HOST',
    'MYSQL_USER',
    'MYSQL_DATABASE',
    'COLLEGE_NAME',
    'STUDENT_ID_REGEX',
    'STUDENT_ID_BATCH_GROUP'
  ];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (process.env.SESSION_SECRET.length < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 characters');
  }
  if (!process.env.COLLEGE_NAME.trim()) {
    throw new Error('COLLEGE_NAME must contain the configured institution name');
  }

  const studentIdPattern = process.env.STUDENT_ID_REGEX;
  if (!studentIdPattern.startsWith('^') || !studentIdPattern.endsWith('$')) {
    throw new Error('STUDENT_ID_REGEX must be anchored with ^ and $');
  }
  const batchCaptureGroup = Number(process.env.STUDENT_ID_BATCH_GROUP);
  if (!Number.isInteger(batchCaptureGroup) || batchCaptureGroup < 1) {
    throw new Error('STUDENT_ID_BATCH_GROUP must be a positive capture-group number');
  }

  let studentIdRegex;
  try {
    studentIdRegex = new RegExp(studentIdPattern);
  } catch (error) {
    throw new Error(`Invalid STUDENT_ID_REGEX: ${error.message}`);
  }
  let captureCount = 0;
  let inCharacterClass = false;
  for (let index = 0; index < studentIdPattern.length; index += 1) {
    const character = studentIdPattern[index];
    if (character === '\\') {
      index += 1;
    } else if (character === '[') {
      inCharacterClass = true;
    } else if (character === ']') {
      inCharacterClass = false;
    } else if (character === '(' && !inCharacterClass &&
        (studentIdPattern[index + 1] !== '?' || studentIdPattern[index + 2] === '<' &&
          studentIdPattern[index + 3] !== '!' && studentIdPattern[index + 3] !== '=')) {
      captureCount += 1;
    }
  }
  if (captureCount < batchCaptureGroup) {
    throw new Error('STUDENT_ID_REGEX must include the configured batch-year capture group');
  }

  return {
    port: Number(process.env.PORT || 3000),
    appOrigin: process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 3000}`,
    sessionSecret: process.env.SESSION_SECRET,
    collegeName: process.env.COLLEGE_NAME.trim(),
    collegeEmailDomain: (process.env.COLLEGE_EMAIL_DOMAIN || '').trim().toLowerCase().replace(/^@/, ''),
    studentIdPattern,
    studentIdRegex,
    batchCaptureGroup,
    privateUploadDir: process.env.PRIVATE_UPLOAD_DIR || './private_uploads',
    mysql: {
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE,
      connectionLimit: 10,
      waitForConnections: true,
      queueLimit: 0
    }
  };
}

module.exports = { loadSettings };
