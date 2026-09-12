import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFRawStream,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ─────────────────────────────────────────────────────────────────────────
// The MATLAB pipeline bakes a patient block into page 1 of every screening
// report (generateScreeningReport.m builds it from the `patient` struct it
// was called with). Those details belong to whoever the pipeline was run for,
// not to whoever is using this app.
//
// This module swaps that block for the submitted form data. The fundus
// images, grades, lesion counts and every other clinical number are left
// exactly as generated — they're derived from the images, so they must not
// change when the patient details do.
//
// The old values are *deleted* from the page's content stream, not painted
// over: a white rectangle would still leave them selectable, copyable and
// visible to any PDF text extractor.
// ─────────────────────────────────────────────────────────────────────────

// Measured from the generated PDFs and identical across all of them: the
// value column sits at x=244.8 with seven 12pt rows whose baselines start
// 222.68pt down a 792pt page.
const LAYOUT = {
  pageIndex: 0,
  valueX: 244.8,
  firstBaselineFromTop: 222.68,
  rowPitch: 12,
  fontSize: 10,
  tolerance: 0.75, // how close a text block must be to count as that cell
};

// Row order must match the table in generateScreeningReport.m.
const PATIENT_ROWS = [
  'Patient ID',
  'Age',
  'Sex',
  'Diabetes',
  'Years since diagnosis',
  'HbA1c',
  'Blood pressure',
];

// Shown when the form didn't collect a value. The pipeline uses an em dash
// for exactly this case, so it matches the document's own convention.
const NOT_PROVIDED = '—';

const FONT_PATH = path.join(process.cwd(), 'assets', 'fonts', 'NotoSans-Regular.ttf');

let cachedFontBytes;
function loadFontBytes() {
  if (cachedFontBytes === undefined) {
    try {
      cachedFontBytes = fs.readFileSync(FONT_PATH);
    } catch {
      cachedFontBytes = null; // fall back to Helvetica
    }
  }
  return cachedFontBytes;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text && text !== 'undefined' && text !== 'null' ? text : '';
}

/**
 * Maps a submission's personalData onto the seven rows of the patient block.
 * Exported so the UI can show exactly what will be written into the PDF.
 */
export function buildPatientRows(submission) {
  const p = submission?.personalData || {};
  const id = submission?._id ? String(submission._id) : '';

  const values = {
    'Patient ID': id ? `RS-${id.slice(-8).toUpperCase()}` : '',
    Age: clean(p.age),
    Sex: clean(p.gender),
    Diabetes: clean(p.diabetesType),
    'Years since diagnosis': clean(p.diabetesDurationYears),
    HbA1c: clean(p.hba1c) ? `${clean(p.hba1c)}%` : '',
    'Blood pressure': clean(p.bloodPressure),
  };

  return PATIENT_ROWS.map((label) => ({
    label,
    value: values[label] || NOT_PROVIDED,
    provided: Boolean(values[label]),
  }));
}

// ── content-stream surgery ───────────────────────────────────────────────

// PDF matrices are [a b c d e f]; this is m applied then n.
function multiply(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2],
    m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2],
    m[2] * n[1] + m[3] * n[3],
    m[4] * n[0] + m[5] * n[2] + n[4],
    m[4] * n[1] + m[5] * n[3] + n[5],
  ];
}

function readContentStreams(pdf, page) {
  const contents = page.node.get(PDFName.of('Contents'));
  const refs = contents instanceof PDFArray ? contents.asArray() : [contents];
  const parts = [];
  for (const ref of refs) {
    const stream = ref instanceof PDFRawStream ? ref : pdf.context.lookup(ref);
    if (!stream?.getContents) continue;
    let bytes = Buffer.from(stream.getContents());
    const filter = stream.dict?.get(PDFName.of('Filter'));
    if (filter && String(filter).includes('FlateDecode')) {
      try {
        bytes = zlib.inflateSync(bytes);
      } catch {
        return null; // unknown encoding — leave the page alone
      }
    }
    parts.push(bytes.toString('latin1'));
  }
  return parts.length ? parts.join('\n') : null;
}

// Walks the stream tracking the CTM so each BT..ET block's text origin can be
// resolved to a position on the page.
function findTextBlocks(content) {
  const blocks = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const tokens = /(q|Q|BT)\b|([-\d.]+(?:\s+[-\d.]+){5})\s+cm/g;

  let match;
  while ((match = tokens.exec(content))) {
    if (match[2]) {
      ctm = multiply(match[2].trim().split(/\s+/).map(Number), ctm);
    } else if (match[1] === 'q') {
      stack.push(ctm.slice());
    } else if (match[1] === 'Q') {
      ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    } else {
      const end = content.indexOf('ET', match.index);
      if (end === -1) continue;
      const body = content.slice(match.index, end + 2);
      const tm = body.match(/([-\d.]+(?:\s+[-\d.]+){5})\s+Tm/);
      const textMatrix = tm
        ? tm[1].trim().split(/\s+/).map(Number)
        : [1, 0, 0, 1, 0, 0];
      const full = multiply(textMatrix, ctm);
      blocks.push({ start: match.index, end: end + 2, matrix: full });
      tokens.lastIndex = end + 2;
    }
  }
  return blocks;
}

// Deletes the seven existing patient values. Returns the rewritten stream, or
// null if the layout didn't look the way we expect.
function stripPatientValues(content, pageHeight) {
  const blocks = findTextBlocks(content);
  const targets = [];

  for (let row = 0; row < PATIENT_ROWS.length; row += 1) {
    const baselineFromTop = LAYOUT.firstBaselineFromTop + row * LAYOUT.rowPitch;
    const hit = blocks.find((b) => {
      const [a, , , d, x, y] = b.matrix;
      // Only plain upright placements — anything rotated or scaled isn't the
      // table cell we measured.
      if (Math.abs(a - 1) > 0.01 || Math.abs(d - 1) > 0.01) return false;
      return (
        Math.abs(x - LAYOUT.valueX) < LAYOUT.tolerance &&
        Math.abs(pageHeight - y - baselineFromTop) < LAYOUT.tolerance
      );
    });
    if (hit) targets.push(hit);
  }

  if (!targets.length) return null;

  // Splice from the end so earlier offsets stay valid.
  let out = content;
  for (const block of targets.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, block.start) + out.slice(block.end);
  }
  return { content: out, removed: targets.length };
}

/**
 * Takes the pipeline's PDF and returns a copy whose patient block reflects
 * this submission. Everything else in the document is untouched.
 *
 * @param {Buffer|Uint8Array} pdfBytes  the report as the pipeline wrote it
 * @param {object} submission           the submission to take details from
 * @returns {Promise<{bytes: Uint8Array, replaced: boolean}>}
 */
export async function personalizeReportPdf(pdfBytes, submission) {
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.getPages()[LAYOUT.pageIndex];
  if (!page) return { bytes: await pdf.save(), replaced: false };

  const pageHeight = page.getHeight();

  // 1. Remove the pipeline's values.
  const content = readContentStreams(pdf, page);
  const stripped = content ? stripPatientValues(content, pageHeight) : null;

  if (stripped) {
    const replacement = pdf.context.flateStream(
      Buffer.from(stripped.content, 'latin1')
    );
    const ref = pdf.context.register(replacement);
    page.node.set(PDFName.of('Contents'), pdf.context.obj([ref]));
  }

  // 2. Write ours onto the same baselines.
  const fontBytes = loadFontBytes();
  let font;
  if (fontBytes) {
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(fontBytes, { subset: true });
  } else {
    font = await pdf.embedFont(StandardFonts.Helvetica);
  }

  buildPatientRows(submission).forEach((row, i) => {
    const baselineFromTop = LAYOUT.firstBaselineFromTop + i * LAYOUT.rowPitch;
    page.drawText(row.value, {
      x: LAYOUT.valueX,
      y: pageHeight - baselineFromTop,
      size: LAYOUT.fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  });

  return { bytes: await pdf.save(), replaced: Boolean(stripped) };
}
