import jsPDF from 'jspdf';

// ─────────────────────────────────────────────────────────────────────────
// EDIT THIS FILE to change what appears on the generated report.
// Everything about the PDF's content lives here — no other file needs to
// change if you add/remove a field or redesign a section.
// ─────────────────────────────────────────────────────────────────────────

// Each section is just a heading + a list of [label, value] rows. Add a new
// field to the report by adding one more entry to a `rows` array below.
export function buildReportSections(submission) {
  const p = submission.personalData || {};

  const sections = [
    {
      heading: 'Patient Information',
      rows: [
        ['Age', p.age],
        ['Gender', p.gender],
        ['Diabetes type', p.diabetesType],
        ['Years since diagnosis', p.diabetesDurationYears],
      ],
    },
    {
      heading: 'Vitals',
      rows: [
        ['Fasting blood sugar', p.bloodSugarLevel && `${p.bloodSugarLevel} mg/dL`],
        ['HbA1c', p.hba1c && `${p.hba1c}%`],
        ['Blood pressure', p.bloodPressure],
        ['Smoker', p.smoker],
      ],
    },
  ];

  // Drop any rows with no value so the report doesn't show blank lines.
  return sections.map((section) => ({
    ...section,
    rows: section.rows.filter(([, value]) => value !== undefined && value !== '' && value !== null),
  }));
}

// TODO (future): once a real detection model is wired up, replace this
// function's return value with the actual model output, e.g.
//   { status: 'Moderate risk detected', confidence: '82%', notes: '...' }
// and update the "Screening Result" block in generateReportPdf() below to
// render whatever fields you return here.
function getScreeningResultPlaceholder() {
  return {
    status: 'Pending automated analysis',
    notes: [
      "This section will show the AI model's risk assessment once the",
      'detection model is integrated. Your data has been recorded for',
      'research and future screening purposes.',
    ],
  };
}

const BRAND_COLOR = [139, 46, 209]; // matches the app's purple accent

// Builds the PDF document object. Split out from downloadReportPdf() so you
// can also use it later for e.g. emailing the report or previewing it inline
// instead of only downloading it.
export function buildReportDoc(submission) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;
  let y = margin;

  // Header banner
  doc.setFillColor(...BRAND_COLOR);
  doc.rect(0, 0, pageWidth, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('RetinaScan — Screening Report', margin, 42);
  y = 100;

  // Metadata
  doc.setTextColor(30, 30, 30);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const submittedDate = new Date(submission.completedAt || submission.createdAt).toLocaleString();
  doc.text(`Report ID: ${submission._id}`, margin, y);
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, y + 14);
  doc.text(`Submission date: ${submittedDate}`, margin, y + 28);
  y += 52;

  // Data sections
  for (const section of buildReportSections(submission)) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...BRAND_COLOR);
    doc.text(section.heading, margin, y);
    y += 18;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    for (const [label, value] of section.rows) {
      doc.text(`${label}:`, margin, y);
      doc.text(String(value), margin + 190, y);
      y += 18;
    }
    y += 12;
  }

  // Screening result (placeholder until the ML model is integrated)
  const result = getScreeningResultPlaceholder();
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND_COLOR);
  doc.text('Screening Result', margin, y);
  y += 18;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  doc.text(`Status: ${result.status}`, margin, y);
  y += 16;
  for (const line of result.notes) {
    doc.text(line, margin, y);
    y += 14;
  }
  y += 20;

  // Eye images
  if (submission.leftEyeImage || submission.rightEyeImage) {
    const imgWidth = 200;
    const imgHeight = 140;
    if (y + imgHeight + 30 > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...BRAND_COLOR);
    doc.text('Captured Images', margin, y);
    y += 16;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    if (submission.leftEyeImage) {
      doc.text('Left eye', margin, y);
      doc.addImage(submission.leftEyeImage, 'JPEG', margin, y + 6, imgWidth, imgHeight);
    }
    if (submission.rightEyeImage) {
      const rightX = margin + imgWidth + 30;
      doc.text('Right eye', rightX, y);
      doc.addImage(submission.rightEyeImage, 'JPEG', rightX, y + 6, imgWidth, imgHeight);
    }
    y += imgHeight + 30;
  }

  // Footer disclaimer
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(
    'This report is generated from self-reported data and has not been reviewed by a medical professional.',
    margin,
    pageHeight - 30
  );

  return doc;
}

// Builds the PDF and immediately triggers a browser download.
export function downloadReportPdf(submission) {
  const doc = buildReportDoc(submission);
  doc.save(`retinascan-report-${submission._id}.pdf`);
}
