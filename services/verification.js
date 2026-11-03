const fs = require('node:fs/promises');
const sharp = require('sharp');
const jsQR = require('jsqr');
const { createWorker } = require('tesseract.js');
const { parseStudentId } = require('./batches');

async function validateImageFile(filePath, declaredMimeType) {
  const file = await fs.open(filePath, 'r');
  const header = Buffer.alloc(12);
  try {
    await file.read(header, 0, header.length, 0);
  } finally {
    await file.close();
  }
  const detectedMimeType = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff
    ? 'image/jpeg'
    : header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? 'image/png'
      : header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
        ? 'image/webp'
        : null;
  if (!detectedMimeType || detectedMimeType !== declaredMimeType) {
    throw new Error('The uploaded file is not a supported JPEG, PNG, or WebP image.');
  }
  return detectedMimeType;
}

function findStudentId(text, settings) {
  const source = settings.studentIdPattern.replace(/^\^/, '').replace(/\$$/, '');
  const matcher = new RegExp(source, 'i');
  const candidates = text.split(/[\s,;|]+/).map((part) => part.trim()).filter(Boolean);
  candidates.unshift(text.trim());
  for (const candidate of candidates) {
    const match = candidate.match(matcher);
    if (match && settings.studentIdRegex.test(match[0]) &&
        parseStudentId(match[0], settings) !== null) {
      return match[0];
    }
  }
  return null;
}

async function readQrCode(imageBuffer) {
  const { data, info } = await sharp(imageBuffer, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
  const result = jsQR(pixels, info.width, info.height, { inversionAttempts: 'attemptBoth' });
  return result?.data || null;
}

async function readOcrText(imageBuffer) {
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(imageBuffer);
    return data.text || '';
  } finally {
    await worker.terminate();
  }
}

function assessCard({ ocrText, qrText, submittedStudentId, settings }) {
  const printedId = findStudentId(ocrText, settings);
  const qrId = qrText ? findStudentId(qrText, settings) : null;
  const collegeNameMatched = ocrText.toLocaleLowerCase().includes(settings.collegeName.toLocaleLowerCase());
  const printedIdMatched = printedId?.toLowerCase() === submittedStudentId.toLowerCase();
  const qrIdMatched = qrId?.toLowerCase() === submittedStudentId.toLowerCase();
  const checksPassed = Boolean(printedIdMatched && qrIdMatched && collegeNameMatched);

  return {
    status: checksPassed ? 'passed' : 'manual_review',
    result: {
      printedId: printedId || null,
      printedIdMatched: Boolean(printedIdMatched),
      qrDecoded: Boolean(qrText),
      qrStudentId: qrId || null,
      qrIdMatched: Boolean(qrIdMatched),
      collegeNameMatched,
      note: 'Automated text and QR checks do not prove that an ID card is genuine.'
    }
  };
}

async function verifyStudentCard({ filePath, submittedMimeType, submittedStudentId, settings }) {
  await validateImageFile(filePath, submittedMimeType);
  let imageBuffer;
  try {
    const metadata = await sharp(filePath, { limitInputPixels: 40_000_000 }).metadata();
    if ((metadata.width || 0) * (metadata.height || 0) > 40_000_000) {
      const error = new Error('ID-card image dimensions are too large to process.');
      error.code = 'INVALID_UPLOAD';
      throw error;
    }
    imageBuffer = await sharp(filePath, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .jpeg()
      .toBuffer();
  } catch (error) {
    if (error.code === 'INVALID_UPLOAD') throw error;
    console.warn('Student-card image could not be decoded and requires manual review:', error.message);
    const assessment = assessCard({ ocrText: '', qrText: null, submittedStudentId, settings });
    assessment.result.processingErrors = ['image_unreadable'];
    return assessment;
  }
  let ocrText = '';
  let qrText = null;
  const processingErrors = [];
  try {
    ocrText = await readOcrText(imageBuffer);
  } catch (error) {
    processingErrors.push('ocr_unreadable');
    console.warn('Student-card OCR requires manual review:', error.message);
  }
  try {
    qrText = await readQrCode(imageBuffer);
  } catch (error) {
    processingErrors.push('qr_unreadable');
    console.warn('Student-card QR processing requires manual review:', error.message);
  }
  const assessment = assessCard({ ocrText, qrText, submittedStudentId, settings });
  assessment.result.processingErrors = processingErrors;
  return assessment;
}

module.exports = {
  assessCard,
  findStudentId,
  validateImageFile,
  verifyStudentCard
};
