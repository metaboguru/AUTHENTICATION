/**
 * Ruflo Workflow Orchestrator
 * Coordinates the multi-agent LC-MS annotation pipeline using claude-flow.
 * Implements the SWARM_TOPOLOGY phases with parallel and sequential execution.
 */

import { parseMzXML, neutralMass } from '../parsers/mzxml-parser.js';
import { spectralSearch } from '../spectral/spectral-matcher.js';
import { searchPubChem, getPubChemCID } from '../databases/pubchem-client.js';
import { comprehensiveDatabaseLookup } from '../databases/hmdb-client.js';
import { fullLiteratureSearch, searchPharmacopoeiaInfo } from '../literature/pubmed-client.js';
import { identifyBotanical, assessAuthenticity } from './botanical-identifier.js';
import { generateReport } from '../reports/report-generator.js';

const MAX_FEATURES = 50; // Process top N features by intensity
const ADDUCTS_POS = ['[M+H]+', '[M+Na]+', '[M+NH4]+', '[M+K]+'];
const ADDUCTS_NEG = ['[M-H]-', '[M+Cl]-', '[M+HCOO]-'];

/**
 * Main pipeline entry point.
 * Orchestrates all agents in the correct phase order.
 *
 * @param {string} filePath  — path to mzXML file
 * @param {Object} options   — { polarity, verbose, outputDir, maxFeatures }
 */
export async function runWorkflow(filePath, options = {}) {
  const {
    polarity: forcedPolarity = null,
    verbose = false,
    outputDir = './output',
    maxFeatures = MAX_FEATURES,
    onProgress = () => {},
  } = options;

  const startTime = Date.now();
  log(verbose, '🔬 LC-MS Metabolomics Annotation Workflow Starting...');
  log(verbose, `   File: ${filePath}`);

  // ─── Phase 0: Parse mzXML ──────────────────────────────────────────────
  onProgress({ phase: 0, step: 'Parsing mzXML', pct: 0 });
  log(verbose, '\n📂 Phase 0: Parsing mzXML file...');

  const parsed = await parseMzXML(filePath, forcedPolarity);
  const { metadata, features } = parsed;

  log(verbose, `   Polarity: ${metadata.polarity}`);
  log(verbose, `   Instrument: ${metadata.instrument.model} (${metadata.instrument.manufacturer})`);
  log(verbose, `   Total MS1 scans: ${metadata.ms1Count}, MS2 scans: ${metadata.ms2Count}`);
  log(verbose, `   Features with MS2: ${metadata.featureCount}`);

  const topFeatures = features.slice(0, maxFeatures);
  log(verbose, `   Processing top ${topFeatures.length} features by intensity`);

  // ─── Phase 1: Spectral + Database Annotation (Parallel) ───────────────
  onProgress({ phase: 1, step: 'Spectral matching & database annotation', pct: 10 });
  log(verbose, '\n🔍 Phase 1: Spectral matching + database annotation (parallel)...');

  const annotatedFeatures = await Promise.all(
    topFeatures.map((feature, i) =>
      annotateFeature(feature, metadata.polarity, verbose, i, topFeatures.length, onProgress)
    )
  );

  // ─── Phase 2: Literature Search (Sequential, uses Phase 1 results) ────
  onProgress({ phase: 2, step: 'Literature search', pct: 55 });
  log(verbose, '\n📚 Phase 2: Literature search...');

  const topAnnotations = getTopAnnotations(annotatedFeatures);
  const literatureResults = await runLiteratureSearch(topAnnotations, verbose);

  // ─── Phase 3: Botanical ID + Authenticity (Parallel) ──────────────────
  onProgress({ phase: 3, step: 'Botanical identification & authenticity', pct: 75 });
  log(verbose, '\n🌿 Phase 3: Botanical identification & authenticity assessment...');

  const allAnnotations = topAnnotations;
  const botanicalCandidates = identifyBotanical(allAnnotations);
  const authenticity = assessAuthenticity(botanicalCandidates, allAnnotations);

  // Enrich with pharmacopoeia info for top botanical
  let pharmacopoeiaInfo = null;
  if (botanicalCandidates.length > 0) {
    const topMarker = botanicalCandidates[0].matchedMarkers?.[0]?.marker || '';
    pharmacopoeiaInfo = await searchPharmacopoeiaInfo(topMarker);
  }

  // ─── Phase 4: Report Generation ───────────────────────────────────────
  onProgress({ phase: 4, step: 'Generating report', pct: 90 });
  log(verbose, '\n📊 Phase 4: Generating annotation report...');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  const report = generateReport({
    metadata,
    annotatedFeatures,
    botanicalCandidates,
    authenticity,
    literatureResults,
    pharmacopoeiaInfo,
    elapsedSec: elapsed,
  });

  onProgress({ phase: 4, step: 'Complete', pct: 100 });
  log(verbose, `\n✅ Workflow complete in ${elapsed}s`);

  return report;
}

/**
 * Annotate a single feature using spectral matching + database lookup.
 */
async function annotateFeature(feature, polarity, verbose, idx, total, onProgress) {
  const pctBase = 10 + Math.floor((idx / total) * 45);
  onProgress({ phase: 1, step: `Feature ${idx + 1}/${total} (m/z ${feature.mz.toFixed(4)})`, pct: pctBase });

  // 1. Spectral matching
  const spectralMatches = await spectralSearch(feature);

  // 2. Database annotation for top spectral matches
  const dbAnnotations = [];
  for (const match of spectralMatches.slice(0, 3)) {
    if (!match.name || match.name === 'Unknown') continue;
    const [pubchemResults, dbResults] = await Promise.all([
      searchPubChem(match.inchiKey || match.name, match.inchiKey ? 'inchikey' : 'name'),
      comprehensiveDatabaseLookup(match.name, match.formula, match.exactMass, match.inchiKey),
    ]);

    dbAnnotations.push({
      spectralMatch: match,
      pubchem: pubchemResults?.[0] || null,
      hmdb: dbResults.hmdb?.[0] || null,
      metabolomicsWorkbench: dbResults.metabolomicsWorkbench?.[0] || null,
      chebi: dbResults.chebi?.[0] || null,
    });
  }

  // 3. Neutral mass calculation for each adduct
  const adducts = polarity === 'POS' ? ADDUCTS_POS : ADDUCTS_NEG;
  const neutralMasses = adducts.map(adduct => ({
    adduct,
    neutralMass: neutralMass(feature.mz, adduct, polarity),
  }));

  return {
    ...feature,
    spectralMatches,
    dbAnnotations,
    neutralMasses,
    topAnnotation: buildTopAnnotation(spectralMatches, dbAnnotations),
  };
}

/**
 * Merge spectral match + DB data into a single best annotation.
 */
function buildTopAnnotation(spectralMatches, dbAnnotations) {
  if (!spectralMatches.length) return null;
  const top = spectralMatches[0];
  const db = dbAnnotations[0];

  return {
    name: db?.pubchem?.iupacName || db?.hmdb?.name || top.name || 'Unknown',
    commonName: top.name,
    formula: db?.hmdb?.formula || db?.metabolomicsWorkbench?.formula || top.formula || '',
    exactMass: db?.pubchem?.exactMass || db?.hmdb?.exactMass || top.exactMass || 0,
    inchiKey: db?.pubchem?.inchiKey || top.inchiKey || '',
    smiles: db?.pubchem?.smiles || top.smiles || '',
    cosineScore: top.cosineScore,
    matchedPeaks: top.matchedPeaks,
    source: top.source,
    classification: {
      kingdom: db?.hmdb?.kingdom || '',
      superClass: db?.hmdb?.superClass || top.superClass || '',
      class: db?.hmdb?.classEl || top.classEl || '',
      subClass: db?.hmdb?.subClass || top.subClass || '',
    },
    adduct: top.adduct || '',
    ppmError: top.ppmError || null,
    pubchemCid: db?.pubchem?.cid || '',
    hmdbId: db?.hmdb?.hmdbId || '',
    plantSources: db?.hmdb?.plantSources || [],
    pharmacopoeia: db?.hmdb?.pharmacopoeiaInfo || null,
  };
}

/**
 * Run literature search for top annotated compounds.
 */
async function runLiteratureSearch(annotations, verbose) {
  const uniqueCompounds = [...new Map(
    annotations.map(a => [a.commonName || a.name, a])
  ).values()].slice(0, 10);

  log(verbose, `   Searching literature for ${uniqueCompounds.length} compounds...`);

  const results = await Promise.all(
    uniqueCompounds.map(ann =>
      fullLiteratureSearch(ann.commonName || ann.name, '', ann.inchiKey)
    )
  );

  // Aggregate botanical mentions from all searches
  const allBotanicals = new Set();
  for (const r of results) {
    for (const b of (r.botanicalMentions || [])) {
      allBotanicals.add(b);
    }
  }

  return {
    byCompound: uniqueCompounds.map((ann, i) => ({
      compound: ann.commonName || ann.name,
      ...results[i],
    })),
    allBotanicalMentions: [...allBotanicals],
    totalArticles: results.reduce((s, r) => s + (r.totalFound || 0), 0),
  };
}

/**
 * Extract top-scored annotations from all annotated features.
 */
function getTopAnnotations(annotatedFeatures) {
  return annotatedFeatures
    .map(f => f.topAnnotation)
    .filter(Boolean)
    .sort((a, b) => (b.cosineScore || 0) - (a.cosineScore || 0));
}

function log(verbose, msg) {
  if (verbose) console.error(msg);
}
