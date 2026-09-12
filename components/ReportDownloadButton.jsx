'use client';

import { useState } from 'react';
import { FileDown, Loader2, CheckCircle2 } from 'lucide-react';
import { downloadReportPdf } from '@/lib/generateReport';

// Simulated "generating" delay before the download starts. Once a real
// backend analysis step exists (e.g. calling your ML model), replace the
// setTimeout below with an actual await fetch(...) call to that endpoint.
const REPORT_GENERATION_DELAY_MS = 10000;

export default function ReportDownloadButton({ submission }) {
  const [status, setStatus] = useState('idle'); // 'idle' | 'generating' | 'done'

  async function handleDownload() {
    setStatus('generating');
    await new Promise((resolve) => setTimeout(resolve, REPORT_GENERATION_DELAY_MS));
    downloadReportPdf(submission);
    setStatus('done');
    setTimeout(() => setStatus('idle'), 2500);
  }

  return (
    <button
      onClick={handleDownload}
      disabled={status === 'generating'}
      className="btn-primary disabled:cursor-not-allowed disabled:opacity-70"
    >
      {status === 'generating' && (
        <>
          <Loader2 size={16} className="animate-spin" /> Generating report...
        </>
      )}
      {status === 'done' && (
        <>
          <CheckCircle2 size={16} /> Downloaded!
        </>
      )}
      {status === 'idle' && (
        <>
          <FileDown size={16} /> Download report
        </>
      )}
    </button>
  );
}
