// Copies the MATLAB pipeline's output into this repo so it deploys with the
// app (Vercel can't reach C:\Pranav\...). Re-run after regenerating reports:
//
//   npm run sync:reports
//
// Source folders come from REPORTS_DIR / SETS_DIR, same as the app uses.
// What lands where:
//   reports/<set>/...        screening PDFs + overlays, read by the API route
//   public/demo-sets/<set>/  the source fundus images, for downloading on a
//                            demo machine (static assets, not in the bundle)
//   lib/sourceImages.json    stem + sha256 per source image — this is what the
//                            matcher actually needs at runtime, so uploads can
//                            be recognised without shipping 46MB of PNGs.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SRC_REPORTS =
  process.env.REPORTS_DIR ||
  'C:\\Pranav\\college\\sih\\SIH_MathWorks_2026\\reports';
const SRC_SETS =
  process.env.SETS_DIR || path.join(path.dirname(SRC_REPORTS), 'sets');

const DEST_REPORTS = path.join(repoRoot, 'reports');
const DEST_IMAGES = path.join(repoRoot, 'public', 'demo-sets');
const DEST_MANIFEST = path.join(repoRoot, 'lib', 'sourceImages.json');

// Pass --no-images to skip the 46MB of source fundus images. The manifest is
// still written, so upload matching keeps working either way.
const withImages = !process.argv.includes('--no-images');

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg']);
const ID_CODE_RE = /([0-9a-f]{12})/i;

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let files = 0;
  let bytes = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      const sub = copyDir(src, dest);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      fs.copyFileSync(src, dest);
      files += 1;
      bytes += fs.statSync(dest).size;
    }
  }
  return { files, bytes };
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`;

if (!fs.existsSync(SRC_REPORTS)) {
  die(`REPORTS_DIR not found: ${SRC_REPORTS}\n  Set REPORTS_DIR in .env.local or the environment.`);
}

// ── reports ──────────────────────────────────────────────────────────────
fs.rmSync(DEST_REPORTS, { recursive: true, force: true });
const reports = copyDir(SRC_REPORTS, DEST_REPORTS);
console.log(`reports/          ${reports.files} files, ${mb(reports.bytes)}  <- ${SRC_REPORTS}`);

// ── source images + hash manifest ────────────────────────────────────────
if (!fs.existsSync(SRC_SETS)) {
  console.warn(`\n  SETS_DIR not found: ${SRC_SETS}`);
  console.warn('  Skipping the source images and hash manifest — uploads will');
  console.warn('  only match by file name, not by content.\n');
  process.exit(0);
}

const manifest = [];
let imageBytes = 0;

// Clear it out first so renamed files don't leave their old copies behind.
if (withImages) fs.rmSync(DEST_IMAGES, { recursive: true, force: true });

for (const dir of fs.readdirSync(SRC_SETS, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const entry of fs.readdirSync(path.join(SRC_SETS, dir.name), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) continue;

    const src = path.join(SRC_SETS, dir.name, entry.name);
    const bytes = fs.readFileSync(src);
    const sourceStem = path.basename(entry.name, ext).toLowerCase();

    // Drop the grade from the published file name: it's the APTOS ground
    // truth, which disagrees with what the report concludes, so showing it
    // to someone picking a demo image is misleading. The 12-hex id code is
    // what actually ties an image to its report, and that survives.
    const publicName = entry.name.replace(/_grade\d(?=_)/i, '');
    const stem = path.basename(publicName, ext).toLowerCase();

    manifest.push({
      set: dir.name,
      stem,
      sourceStem,
      file: publicName,
      sourceFile: entry.name,
      idCode: sourceStem.match(ID_CODE_RE)?.[1]?.toLowerCase() || null,
      // Kept for reference only — the UI takes grades from the report.
      groundTruthGrade: sourceStem.match(/grade(\d)/i)
        ? Number(sourceStem.match(/grade(\d)/i)[1])
        : null,
      eye: /(^|_)left(_|$)/.test(stem) ? 'left' : /(^|_)right(_|$)/.test(stem) ? 'right' : null,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: bytes.length,
      publicPath: `/demo-sets/${dir.name}/${publicName}`,
    });

    if (withImages) {
      const dest = path.join(DEST_IMAGES, dir.name, publicName);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, bytes);
      imageBytes += bytes.length;
    }
  }
}

manifest.sort((a, b) => a.stem.localeCompare(b.stem));
fs.writeFileSync(DEST_MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log(
  `lib/sourceImages.json  ${manifest.length} images hashed, ${mb(fs.statSync(DEST_MANIFEST).size)}`
);
if (withImages) {
  console.log(`public/demo-sets/ ${manifest.length} files, ${mb(imageBytes)}  <- ${SRC_SETS}`);
} else {
  console.log('public/demo-sets/ skipped (--no-images)');
}
console.log('\nDone. Commit the changes to deploy them.');
