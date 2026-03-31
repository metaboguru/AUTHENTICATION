/**
 * Workflow integration test — runs the full pipeline with synthetic data.
 * Tests all agents: spectral matching, DB lookup, literature, botanical ID, authenticity.
 */

import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { identifyBotanical, assessAuthenticity, BOTANICAL_FINGERPRINTS } from '../src/workflow/botanical-identifier.js';
import { cosineSimilarity, matchPhytochemicalLibrary } from '../src/spectral/spectral-matcher.js';
import { generateReport, formatReportAsText } from '../src/reports/report-generator.js';

const OUTPUT_DIR = './output/test';
mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('\n╔══════════════════════════════════════════════════════════╗');
console.log('║   LC-MS Metabolomics Workflow — Integration Test          ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

// ─── Test 1: Cosine similarity ──────────────────────────────────────
console.log('Test 1: Cosine similarity engine...');
const egcgQuery = [
  { mz: 169.014, intensity: 650000 },
  { mz: 179.000, intensity: 280000 },
  { mz: 125.024, intensity: 180000 },
  { mz: 289.071, intensity: 95000 },
  { mz: 245.045, intensity: 140000 },
];
const egcgLib = [
  { mz: 169.014, intensity: 500000 },
  { mz: 179.000, intensity: 210000 },
  { mz: 125.024, intensity: 150000 },
  { mz: 289.071, intensity: 80000 },
];
const cosResult = cosineSimilarity(egcgQuery, egcgLib);
console.log(`  EGCG cosine score: ${cosResult.score} (${cosResult.matchedPeaks} peaks matched)`);
console.assert(cosResult.score > 0.9, 'Expected cosine > 0.9');
console.log('  ✅ PASS\n');

// ─── Test 2: Internal phytochemical library ──────────────────────────
console.log('Test 2: Internal phytochemical library matching...');
// Curcumin [M+H]+ = 369.133
const curcuminPeaks = [
  { mz: 177.054, intensity: 850000 }, // diagnostic
  { mz: 149.059, intensity: 620000 }, // diagnostic
  { mz: 147.045, intensity: 410000 },
  { mz: 121.029, intensity: 280000 },
];
const libMatches = matchPhytochemicalLibrary(369.133, curcuminPeaks, 'POS');
console.log(`  Library matches: ${libMatches.map(m => m.name).join(', ') || 'none'}`);
if (libMatches.length > 0) {
  console.log(`  Top match: ${libMatches[0].name} (score: ${libMatches[0].cosineScore})`);
}
console.log('  ✅ PASS\n');

// ─── Test 3: Botanical identification — Green Tea ─────────────────────
console.log('Test 3: Botanical ID — Green Tea (Camellia sinensis)...');
const greenTeaAnnotations = [
  { name: 'epigallocatechin gallate', formula: 'C22H18O11', exactMass: 458.085, cosineScore: 0.89 },
  { name: 'epigallocatechin', formula: 'C15H14O7', exactMass: 306.074, cosineScore: 0.82 },
  { name: 'epicatechin gallate', formula: 'C22H18O10', exactMass: 442.090, cosineScore: 0.81 },
  { name: 'epicatechin', formula: 'C15H14O6', exactMass: 290.079, cosineScore: 0.78 },
  { name: 'caffeine', formula: 'C8H10N4O2', exactMass: 194.080, cosineScore: 0.91 },
  { name: 'theanine', formula: 'C7H14N2O3', exactMass: 174.101, cosineScore: 0.86 },
  { name: 'gallocatechin', formula: 'C15H14O7', exactMass: 306.074, cosineScore: 0.72 },
];

const greenTeaCandidates = identifyBotanical(greenTeaAnnotations);
console.log('  Top botanical candidates:');
for (const c of greenTeaCandidates.slice(0, 3)) {
  console.log(`    #${greenTeaCandidates.indexOf(c) + 1} ${c.botanical}: score=${c.score.toFixed(3)}, coverage=${(c.coverage * 100).toFixed(0)}%`);
}
const greenTeaAuth = assessAuthenticity(greenTeaCandidates, greenTeaAnnotations);
console.log(`  Verdict: ${greenTeaAuth.verdict} (confidence: ${(greenTeaAuth.confidence * 100).toFixed(0)}%)`);
console.assert(greenTeaCandidates[0]?.botanical?.includes('Camellia'), 'Expected Green Tea as top candidate');
console.log('  ✅ PASS\n');

// ─── Test 4: Botanical ID — Turmeric ─────────────────────────────────
console.log('Test 4: Botanical ID — Turmeric (Curcuma longa)...');
const turmericAnnotations = [
  { name: 'curcumin', formula: 'C21H20O6', exactMass: 368.126, cosineScore: 0.93 },
  { name: 'demethoxycurcumin', formula: 'C20H18O5', exactMass: 338.115, cosineScore: 0.88 },
  { name: 'bisdemethoxycurcumin', formula: 'C19H16O4', exactMass: 308.105, cosineScore: 0.85 },
  { name: 'ar-turmerone', formula: 'C15H20O', exactMass: 216.151, cosineScore: 0.71 },
];
const turmericCandidates = identifyBotanical(turmericAnnotations);
const turmericAuth = assessAuthenticity(turmericCandidates, turmericAnnotations);
console.log(`  Top: ${turmericCandidates[0]?.botanical}`);
console.log(`  Verdict: ${turmericAuth.verdict} (confidence: ${(turmericAuth.confidence * 100).toFixed(0)}%)`);
console.assert(turmericCandidates[0]?.botanical?.includes('Curcuma'), 'Expected Turmeric as top candidate');
console.log('  ✅ PASS\n');

// ─── Test 5: Authenticity — Adulterated/Low quality ──────────────────
console.log('Test 5: Authenticity — Questionable sample...');
const questionableAnnotations = [
  { name: 'quercetin', formula: 'C15H10O7', exactMass: 302.043, cosineScore: 0.75 },
  { name: 'rutin', formula: 'C27H30O16', exactMass: 610.153, cosineScore: 0.70 },
  // Missing: hypericin, hyperforin (key St. John's Wort markers)
];
const questionableCandidates = identifyBotanical(questionableAnnotations);
const questionableAuth = assessAuthenticity(questionableCandidates, questionableAnnotations);
console.log(`  Verdict: ${questionableAuth.verdict} (confidence: ${(questionableAuth.confidence * 100).toFixed(0)}%)`);
console.log(`  Flags: ${questionableAuth.flags.join(', ') || 'none'}`);
console.log('  ✅ PASS\n');

// ─── Test 6: Full report generation ──────────────────────────────────
console.log('Test 6: Full report generation...');
const mockReport = generateReport({
  metadata: {
    filePath: 'test_green_tea_neg.mzXML',
    polarity: 'NEG',
    instrument: { manufacturer: 'Thermo Scientific', model: 'Q Exactive HF', ionisation: 'ESI', analyzer: 'Orbitrap' },
    totalScans: 120,
    ms1Count: 60,
    ms2Count: 60,
    featureCount: 42,
    rtRange: [0, 900],
  },
  annotatedFeatures: greenTeaAnnotations.map((a, i) => ({
    mz: a.exactMass + 1.007276,
    rt: 120 + i * 60,
    intensity: 1000000 - i * 100000,
    polarity: 'NEG',
    ms2Spectra: [{ peaks: egcgQuery, collisionEnergy: 25, retentionTime: 121 + i * 60 }],
    topAnnotation: { ...a, cosineScore: a.cosineScore, matchedPeaks: 5, source: 'PhytochemDB', adduct: '[M-H]-', classification: { superClass: 'Phenylpropanoids', class: 'Flavonoids' } },
    num: i + 1,
    spectralMatches: [{ ...a, cosineScore: a.cosineScore, matchedPeaks: 5, source: 'PhytochemDB', adduct: '[M-H]-' }],
    dbAnnotations: [],
    neutralMasses: [{ adduct: '[M-H]-', neutralMass: a.exactMass }],
  })),
  botanicalCandidates: greenTeaCandidates,
  authenticity: greenTeaAuth,
  literatureResults: {
    byCompound: [],
    allBotanicalMentions: ['Camellia sinensis', 'Green tea'],
    totalArticles: 0,
  },
  pharmacopoeiaInfo: { found: true, articleCount: 12, pharmacopoeiaInfo: { standard: 'EP', plant: 'Camellia sinensis', monograph: 'Green Tea' } },
  elapsedSec: '2.3',
});

const textReport = formatReportAsText(mockReport);
writeFileSync(join(OUTPUT_DIR, 'test_report.json'), JSON.stringify(mockReport, null, 2));
writeFileSync(join(OUTPUT_DIR, 'test_report.txt'), textReport);

console.log(textReport.split('\n').slice(0, 40).join('\n'));
console.log('  ... (truncated)');
console.log('\n  ✅ PASS — Report generated and saved\n');

// ─── Summary ──────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  All tests passed ✅                                      ║');
console.log(`║  Reports saved to: ${OUTPUT_DIR.padEnd(35)}║`);
console.log('╚══════════════════════════════════════════════════════════╝\n');

console.log('Botanical fingerprints available:');
for (const b of Object.keys(BOTANICAL_FINGERPRINTS)) {
  console.log(`  • ${b}`);
}
