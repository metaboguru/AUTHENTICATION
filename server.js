/**
 * LC-MS Metabolomics Web Server
 * Express + SSE for live-streaming annotation results to the browser.
 * Endpoints:
 *   GET  /              → serves the SPA (public/index.html)
 *   POST /annotate      → uploads mzXML, starts workflow, returns SSE job ID
 *   GET  /stream/:jobId → SSE stream with live phase events
 *   GET  /download/:jobId/:type → download json|txt report
 */

import express from 'express';
import multer from 'multer';
import { mkdirSync, existsSync, createReadStream } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

import { parseMzXML } from './src/parsers/mzxml-parser.js';
import { spectralSearch } from './src/spectral/spectral-matcher.js';
import { searchPubChem } from './src/databases/pubchem-client.js';
import { comprehensiveDatabaseLookup } from './src/databases/hmdb-client.js';
import { fullLiteratureSearch, searchPharmacopoeiaInfo } from './src/literature/pubmed-client.js';
import { identifyBotanical, assessAuthenticity } from './src/workflow/botanical-identifier.js';
import { generateReport, formatReportAsText } from './src/reports/report-generator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = join(__dirname, 'output', 'uploads');
const REPORT_DIR = join(__dirname, 'output', 'reports');
mkdirSync(UPLOAD_DIR, { recursive: true });
mkdirSync(REPORT_DIR, { recursive: true });

const app = express();
const PORT = process.env.PORT || 3000;

// ── Multer: accept .mzXML / .mzxml files ──────────────────────────────────────
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
  fileFilter: (req, file, cb) => {
    if (/\.mzxml$/i.test(file.originalname) || file.mimetype === 'text/xml' || file.mimetype === 'application/xml') {
      cb(null, true);
    } else {
      cb(new Error('Only .mzXML files are accepted'));
    }
  },
});

// ── In-memory job store ───────────────────────────────────────────────────────
// Map<jobId, { clients: Set<SSEClient>, report, status, error }>
const jobs = new Map();

function createJob() {
  const id = randomBytes(8).toString('hex');
  jobs.set(id, { clients: new Set(), report: null, status: 'queued', error: null });
  return id;
}

function sendEvent(jobId, event, data) {
  const job = jobs.get(jobId);
  if (!job) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of job.clients) {
    try { res.write(payload); } catch {}
  }
}

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(join(__dirname, 'public')));

// ── SSE stream endpoint ───────────────────────────────────────────────────────
app.get('/stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  job.clients.add(res);

  // If already finished, replay final events immediately
  if (job.status === 'done') {
    res.write(`event: done\ndata: ${JSON.stringify({ reportId: req.params.jobId })}\n\n`);
    res.end();
    return;
  }
  if (job.status === 'error') {
    res.write(`event: error\ndata: ${JSON.stringify({ message: job.error })}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => job.clients.delete(res));
});

// ── Upload + run annotation ───────────────────────────────────────────────────
app.post('/annotate', upload.single('mzxml'), async (req, res) => {
  if (!req.file && !req.body?.demo) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const polarity = (req.body?.polarity || '').toUpperCase() || null;
  const maxFeatures = Math.min(parseInt(req.body?.maxFeatures || 50), 100);
  const demo = req.body?.demo === 'true';

  const jobId = createJob();
  res.json({ jobId });

  // Run workflow in background (don't await)
  runWorkflowStreaming(jobId, req.file, { polarity: polarity || null, maxFeatures, demo }).catch(err => {
    const job = jobs.get(jobId);
    if (job) { job.status = 'error'; job.error = err.message; }
    sendEvent(jobId, 'error', { message: err.message });
  });
});

// ── Download report ───────────────────────────────────────────────────────────
app.get('/download/:jobId/:type', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job?.report) return res.status(404).json({ error: 'Report not ready' });

  const type = req.params.type; // 'json' or 'txt'
  const filePath = type === 'json'
    ? join(REPORT_DIR, `${req.params.jobId}.json`)
    : join(REPORT_DIR, `${req.params.jobId}.txt`);

  if (!existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  res.download(filePath, type === 'json' ? 'annotation_report.json' : 'annotation_report.txt');
});

// ── Core streaming workflow ───────────────────────────────────────────────────
async function runWorkflowStreaming(jobId, file, { polarity, maxFeatures, demo }) {
  const job = jobs.get(jobId);
  job.status = 'running';

  const send = (event, data) => sendEvent(jobId, event, data);

  send('progress', { phase: 0, pct: 2, label: 'Parsing mzXML file…' });

  // ── Phase 0: Parse ──────────────────────────────────────────────────────
  let originalName = file?.originalname || 'sample.mzXML';
  let metadata, topFeatures;

  if (demo) {
    originalName = 'demo_green_tea_NEG.mzXML';
    ({ metadata, topFeatures } = buildDemoFeatures(polarity || 'NEG'));
  } else {
    const parsed = await parseMzXML(file.path, polarity);
    metadata = parsed.metadata;
    topFeatures = parsed.features.slice(0, maxFeatures);
  }

  send('metadata', { metadata });
  send('progress', { phase: 1, pct: 8, label: `Parsed ${metadata.ms2Count} MS2 scans, ${metadata.featureCount} features` });

  // ── Phase 1: Spectral + DB (parallel per feature, streaming results) ────
  send('progress', { phase: 1, pct: 10, label: 'Phase 1 — Spectral matching & database annotation…' });

  const annotatedFeatures = [];
  const batchSize = 5;

  for (let i = 0; i < topFeatures.length; i += batchSize) {
    const batch = topFeatures.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(f => annotateFeatureFull(f, metadata.polarity)));
    annotatedFeatures.push(...batchResults);

    const pct = 10 + Math.floor(((i + batch.length) / topFeatures.length) * 40);
    send('progress', { phase: 1, pct, label: `Annotating features… ${annotatedFeatures.length}/${topFeatures.length}` });

    // Stream partial feature rows as they arrive
    const rows = batchResults.map(f => featureToRow(f));
    send('features', { rows });
  }

  // ── Phase 2: Literature ─────────────────────────────────────────────────
  send('progress', { phase: 2, pct: 52, label: 'Phase 2 — Literature search (PubMed, Europe PMC, CrossRef)…' });

  const topAnnotations = annotatedFeatures.map(f => f.topAnnotation).filter(Boolean);
  const uniqueCompounds = [...new Map(topAnnotations.map(a => [a.commonName || a.name, a])).values()].slice(0, 10);

  const litResults = await Promise.all(
    uniqueCompounds.map(a => fullLiteratureSearch(a.commonName || a.name, '', a.inchiKey))
  );
  const literatureResults = {
    byCompound: uniqueCompounds.map((a, i) => ({ compound: a.commonName || a.name, ...litResults[i] })),
    allBotanicalMentions: [...new Set(litResults.flatMap(r => r.botanicalMentions || []))],
    totalArticles: litResults.reduce((s, r) => s + (r.totalFound || 0), 0),
  };

  send('literature', { results: literatureResults });
  send('progress', { phase: 2, pct: 68, label: `Literature: ${literatureResults.totalArticles} articles found` });

  // ── Phase 3: Botanical ID + Authenticity ────────────────────────────────
  send('progress', { phase: 3, pct: 70, label: 'Phase 3 — Botanical identification & authenticity assessment…' });

  const botanicalCandidates = identifyBotanical(topAnnotations);
  const authenticity = assessAuthenticity(botanicalCandidates, topAnnotations);

  let pharmacopoeiaInfo = null;
  if (botanicalCandidates[0]?.matchedMarkers?.[0]) {
    pharmacopoeiaInfo = await searchPharmacopoeiaInfo(botanicalCandidates[0].matchedMarkers[0].marker);
  }

  send('botanical', { candidates: botanicalCandidates, authenticity, pharmacopoeiaInfo });
  send('progress', { phase: 3, pct: 85, label: `Botanical: ${botanicalCandidates[0]?.botanical || 'Undetermined'} — ${authenticity.verdict}` });

  // ── Phase 4: Report ─────────────────────────────────────────────────────
  send('progress', { phase: 4, pct: 90, label: 'Phase 4 — Generating report…' });

  const report = generateReport({
    metadata: { ...metadata, filePath: originalName },
    annotatedFeatures,
    botanicalCandidates,
    authenticity,
    literatureResults,
    pharmacopoeiaInfo,
    elapsedSec: '—',
  });

  const textReport = formatReportAsText(report);

  await Promise.all([
    writeFile(join(REPORT_DIR, `${jobId}.json`), JSON.stringify(report, null, 2)),
    writeFile(join(REPORT_DIR, `${jobId}.txt`), textReport),
  ]);

  job.report = report;
  job.status = 'done';

  send('progress', { phase: 4, pct: 100, label: 'Complete!' });
  send('done', { jobId, summary: report.executive_summary });

  // Clean up upload file
  if (file?.path) { unlink(file.path).catch(() => {}); }
}

// ── Per-feature annotation helper ────────────────────────────────────────────
async function annotateFeatureFull(feature, polarity) {
  const spectralMatches = await spectralSearch(feature);
  const dbAnnotations = [];

  for (const match of spectralMatches.slice(0, 2)) {
    if (!match.name || match.name === 'Unknown') continue;
    const [pubchem, db] = await Promise.all([
      searchPubChem(match.inchiKey || match.name, match.inchiKey ? 'inchikey' : 'name'),
      comprehensiveDatabaseLookup(match.name, match.formula, match.exactMass, match.inchiKey),
    ]);
    dbAnnotations.push({ spectralMatch: match, pubchem: pubchem?.[0] || null, hmdb: db.hmdb?.[0] || null, mw: db.metabolomicsWorkbench?.[0] || null });
  }

  const topMatch = spectralMatches[0];
  const topDb = dbAnnotations[0];

  const ADDUCTS = polarity === 'POS'
    ? ['[M+H]+', '[M+Na]+', '[M+NH4]+', '[M+K]+']
    : ['[M-H]-', '[M+Cl]-', '[M+HCOO]-'];

  const mainAdduct = polarity === 'POS' ? 1.007276 : -1.007276;

  const topAnnotation = topMatch ? {
    name: topDb?.hmdb?.name || topMatch.name,
    commonName: topMatch.name,
    formula: topDb?.hmdb?.formula || topDb?.mw?.formula || topMatch.formula || '',
    exactMass: topDb?.pubchem?.exactMass || topDb?.hmdb?.exactMass || topMatch.exactMass || 0,
    inchiKey: topDb?.pubchem?.inchiKey || topMatch.inchiKey || '',
    smiles: topDb?.pubchem?.smiles || topMatch.smiles || '',
    cosineScore: topMatch.cosineScore,
    matchedPeaks: topMatch.matchedPeaks,
    source: topMatch.source,
    adduct: topMatch.adduct || (polarity === 'POS' ? '[M+H]+' : '[M-H]-'),
    ppmError: topMatch.ppmError || null,
    pubchemCid: topDb?.pubchem?.cid || '',
    hmdbId: topDb?.hmdb?.hmdbId || '',
    classification: {
      superClass: topDb?.hmdb?.superClass || topMatch.superClass || '',
      class: topDb?.hmdb?.classEl || topMatch.classEl || '',
    },
    plantSources: topDb?.hmdb?.plantSources || [],
  } : null;

  return { ...feature, spectralMatches, dbAnnotations, topAnnotation, neutralMasses: ADDUCTS.map(a => ({ adduct: a, neutralMass: +(feature.mz + mainAdduct).toFixed(6) })) };
}

function featureToRow(f) {
  const t = f.topAnnotation;
  return {
    mz: f.mz,
    rt_min: +(f.rt / 60).toFixed(2),
    intensity: f.intensity,
    polarity: f.polarity,
    annotation: t?.commonName || t?.name || '—',
    formula: t?.formula || '',
    exact_mass: t?.exactMass || 0,
    cosine_score: t?.cosineScore || 0,
    matched_peaks: t?.matchedPeaks || 0,
    adduct: t?.adduct || '',
    ppm_error: t?.ppmError || null,
    source_db: t?.source || '',
    pubchem_cid: t?.pubchemCid || '',
    hmdb_id: t?.hmdbId || '',
    superclass: t?.classification?.superClass || '',
    class: t?.classification?.class || '',
  };
}

// ── Demo synthetic feature builder ───────────────────────────────────────────
// Bypasses mzXML parsing — injects real green-tea spectral features directly.
function buildDemoFeatures(polarity = 'NEG') {
  const adduct = polarity === 'NEG' ? -1.007276 : 1.007276;
  // Each entry: [neutral_mass, rt_sec, intensity, ms2_peaks_array, name]
  const compounds = [
    // EGCG  neutral 458.0852
    [458.0852, 120, 1850000,
      [{mz:169.014,intensity:650000},{mz:179.000,intensity:280000},{mz:125.024,intensity:180000},{mz:289.071,intensity:95000},{mz:245.045,intensity:140000}],
      'EGCG'],
    // Epicatechin  neutral 290.0790
    [290.0790, 200, 980000,
      [{mz:245.045,intensity:420000},{mz:179.035,intensity:310000},{mz:137.024,intensity:185000},{mz:109.029,intensity:95000}],
      'epicatechin'],
    // Chlorogenic acid  neutral 354.0951
    [354.0951, 260, 720000,
      [{mz:191.056,intensity:380000},{mz:179.035,intensity:280000},{mz:135.045,intensity:210000},{mz:173.045,intensity:140000}],
      'chlorogenic acid'],
    // Theanine  neutral 174.1008
    [174.1008, 310, 540000,
      [{mz:84.045,intensity:290000},{mz:130.087,intensity:185000},{mz:56.050,intensity:95000}],
      'theanine'],
    // Catechin  neutral 290.0790
    [290.0790, 155, 820000,
      [{mz:245.045,intensity:385000},{mz:179.035,intensity:280000},{mz:203.070,intensity:165000}],
      'catechin'],
    // EGC  neutral 306.0739
    [306.0739, 90, 1100000,
      [{mz:261.077,intensity:520000},{mz:179.035,intensity:390000},{mz:125.024,intensity:245000}],
      'epigallocatechin'],
  ];

  const features = compounds.map(([mass, rt, intensity, ms2peaks, _name], i) => ({
    mz: +(mass + adduct).toFixed(6),
    rt,
    intensity,
    polarity,
    num: i + 1,
    ms2Spectra: [{
      scanNum: i * 2 + 2,
      retentionTime: rt + 1,
      collisionEnergy: 25,
      peaks: ms2peaks,
      precursorMz: +(mass + adduct).toFixed(6),
    }],
    basePeakMz: ms2peaks[0]?.mz || 0,
    peaksCount: ms2peaks.length,
  }));

  const metadata = {
    filePath: 'demo_green_tea_NEG.mzXML',
    polarity,
    instrument: { manufacturer: 'Thermo Scientific', model: 'Q Exactive HF', ionisation: 'ESI', analyzer: 'Orbitrap', detector: 'Orbitrap' },
    totalScans: 12,
    ms1Count: 6,
    ms2Count: 6,
    featureCount: features.length,
    rtRange: [60, 400],
  };

  return { metadata, topFeatures: features };
}

// ── Demo mzXML helper ─────────────────────────────────────────────────────────
async function writeDemoFile() {
  const { writeFileSync } = await import('fs');
  const path = join(UPLOAD_DIR, 'demo_greentea.mzXML');
  writeFileSync(path, DEMO_MZXML);
  return path;
}

const DEMO_MZXML = `<?xml version="1.0" encoding="ISO-8859-1"?>
<mzXML xmlns="http://sashimi.sourceforge.net/schema_revision/mzXML_3.2">
  <msRun scanCount="8" startTime="PT0.5S" endTime="PT900S">
    <msInstrument>
      <msManufacturer category="msManufacturer" value="Thermo Scientific"/>
      <msModel category="msModel" value="Q Exactive HF"/>
      <msIonisation category="msIonisation" value="ESI"/>
      <msMassAnalyzer category="msMassAnalyzer" value="Orbitrap"/>
      <msDetector category="msDetector" value="Orbitrap"/>
    </msInstrument>
    <scan num="1" msLevel="1" peaksCount="6" polarity="-" retentionTime="PT120S"
          basePeakMz="457.0774" basePeakIntensity="1850000" totIonCurrent="5200000" lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
    <scan num="2" msLevel="2" peaksCount="5" polarity="-" retentionTime="PT121S"
          basePeakMz="169.014" basePeakIntensity="650000" totIonCurrent="1800000" lowMz="50" highMz="460" collisionEnergy="25">
      <precursorMz precursorIntensity="1850000">457.0774</precursorMz>
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
    <scan num="3" msLevel="1" peaksCount="5" polarity="-" retentionTime="PT180S"
          basePeakMz="289.0714" basePeakIntensity="980000" totIonCurrent="3100000" lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
    <scan num="4" msLevel="2" peaksCount="4" polarity="-" retentionTime="PT181S"
          basePeakMz="245.045" basePeakIntensity="420000" totIonCurrent="1100000" collisionEnergy="25">
      <precursorMz precursorIntensity="980000">289.0714</precursorMz>
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
    <scan num="5" msLevel="1" peaksCount="4" polarity="-" retentionTime="PT240S"
          basePeakMz="353.088" basePeakIntensity="720000" totIonCurrent="2100000" lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
    <scan num="6" msLevel="2" peaksCount="4" polarity="-" retentionTime="PT241S"
          basePeakMz="191.056" basePeakIntensity="380000" totIonCurrent="950000" collisionEnergy="30">
      <precursorMz precursorIntensity="720000">353.088</precursorMz>
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
    <scan num="7" msLevel="1" peaksCount="3" polarity="-" retentionTime="PT300S"
          basePeakMz="173.094" basePeakIntensity="540000" totIonCurrent="1400000" lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
    <scan num="8" msLevel="2" peaksCount="3" polarity="-" retentionTime="PT301S"
          basePeakMz="84.045" basePeakIntensity="290000" totIonCurrent="720000" collisionEnergy="20">
      <precursorMz precursorIntensity="540000">173.094</precursorMz>
      <peaks precision="32" byteOrder="network">AAAAAAAAAAAA</peaks>
    </scan>
  </msRun>
</mzXML>`;

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  LC-MS Metabolomics Web UI                           ║`);
  console.log(`║  Open in browser:  http://localhost:${PORT}             ║`);
  console.log(`╚══════════════════════════════════════════════════════╝\n`);
});
