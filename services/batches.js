async function isBatchActive(pool, batchYear) {
  if (!batchYear) return false;
  const [rows] = await pool.execute(
    'SELECT active FROM authorized_batches WHERE batch_year = ?',
    [batchYear]
  );
  return rows.length > 0 && Boolean(rows[0].active);
}

function parseStudentId(studentId, settings) {
  const match = settings.studentIdRegex.exec(studentId);
  if (!match) return null;
  const year = Number(match[settings.batchCaptureGroup]);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  return year;
}

module.exports = { isBatchActive, parseStudentId };
