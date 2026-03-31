/**
 * Report Generator
 * Produces structured JSON + human-readable text reports from annotation results.
 */

/**
 * Generate the full annotation report.
 */
export function generateReport({
  metadata,
  annotatedFeatures,
  botanicalCandidates,
  authenticity,
  literatureResults,
  pharmacopoeiaInfo,
  elapsedSec,
}) {
  const timestamp = new Date().toISOString();
  const topBotanical = botanicalCandidates[0] || null;

  // Build feature annotation table
  const featureTable = annotatedFeatures.map(f => {
    const top = f.topAnnotation;
    const bestMs2 = f.ms2Spectra?.[0];
    return {
      feature_id: `F${String(f.num || f.ms2Spectra?.[0]?.parentScanNum || Math.round(f.mz * 100)).padStart(5, '0')}`,
      mz: f.mz,
      rt_sec: f.rt,
      rt_min: +(f.rt / 60).toFixed(3),
      polarity: f.polarity,
      intensity: f.intensity,
      ms2_scans: f.ms2Spectra?.length || 0,
      annotation: top?.commonName || top?.name || 'Unknown',
      iupac_name: top?.name || '',
      formula: top?.formula || '',
      exact_mass: top?.exactMass || 0,
      mass_error_ppm: top?.ppmError || null,
      cosine_score: top?.cosineScore || 0,
      matched_peaks: top?.matchedPeaks || 0,
      adduct: top?.adduct || '',
      inchikey: top?.inchiKey || '',
      source_db: top?.source || '',
      classification_superclass: top?.classification?.superClass || '',
      classification_class: top?.classification?.class || '',
      pubchem_cid: top?.pubchemCid || '',
      hmdb_id: top?.hmdbId || '',
      collision_energy: bestMs2?.collisionEnergy || '',
    };
  }).filter(f => f.annotation !== 'Unknown' || f.cosine_score > 0);

  // Build botanical evidence table
  const botanicalTable = botanicalCandidates.map((b, i) => ({
    rank: i + 1,
    botanical: b.botanical,
    species: b.species,
    family: b.family,
    score: b.score,
    coverage_pct: +(b.coverage * 100).toFixed(1),
    matched_markers: b.matchedMarkers?.map(m => m.marker).join('; ') || '',
    missing_markers: b.missedMarkers?.join('; ') || '',
    pharmacopoeia: b.pharmacopoeia?.join(', ') || '',
    plant_parts: b.parts?.join(', ') || '',
    known_adulterants: b.knownAdulterants?.join('; ') || '',
  }));

  // Top literature references
  const topRefs = [];
  for (const compound of (literatureResults?.byCompound || [])) {
    for (const art of (compound.articles || []).slice(0, 3)) {
      topRefs.push({
        compound: compound.compound,
        title: art.title,
        authors: art.authors,
        journal: art.journal,
        year: art.year,
        doi: art.doi,
        url: art.url,
        botanicals_mentioned: art.botanicalMention?.join(', ') || '',
      });
    }
  }

  // Build the complete report object
  const report = {
    report_metadata: {
      title: 'LC-MS Metabolomics Botanical Annotation Report',
      generated_at: timestamp,
      workflow_version: '1.0.0',
      processing_time_sec: elapsedSec,
      tool: 'lcms-metabolomics-workflow (ruflo)',
    },
    sample_metadata: {
      file: metadata.filePath,
      polarity: metadata.polarity,
      instrument_manufacturer: metadata.instrument.manufacturer,
      instrument_model: metadata.instrument.model,
      ionisation: metadata.instrument.ionisation,
      mass_analyzer: metadata.instrument.analyzer,
      total_scans: metadata.totalScans,
      ms1_scans: metadata.ms1Count,
      ms2_scans: metadata.ms2Count,
      features_with_ms2: metadata.featureCount,
      features_processed: annotatedFeatures.length,
      rt_range_sec: metadata.rtRange,
    },
    executive_summary: buildExecutiveSummary(topBotanical, authenticity, featureTable, literatureResults),
    authenticity_assessment: {
      verdict: authenticity.verdict,
      authentic: authenticity.authentic,
      confidence: authenticity.confidence,
      primary_botanical: authenticity.primaryBotanical,
      coverage_pct: authenticity.coveragePct,
      matched_markers: authenticity.matchedMarkers,
      missing_markers: authenticity.missingMarkers,
      flags: authenticity.flags,
      rationale: authenticity.reason,
      pharmacopoeia_standards: authenticity.pharmacopoeia,
      pharmacopoeia_article_count: pharmacopoeiaInfo?.articleCount || 0,
      recommended_confirmatory_tests: getConfirmatoryTests(authenticity, topBotanical),
    },
    botanical_identification: {
      candidates: botanicalTable,
      all_botanical_mentions_from_literature: literatureResults?.allBotanicalMentions || [],
      total_literature_articles: literatureResults?.totalArticles || 0,
    },
    feature_annotations: featureTable,
    literature_references: topRefs.slice(0, 30),
    quality_metrics: buildQualityMetrics(featureTable, annotatedFeatures),
  };

  return report;
}

function buildExecutiveSummary(topBotanical, authenticity, featureTable, literatureResults) {
  const annotatedCount = featureTable.filter(f => f.annotation !== 'Unknown').length;
  const totalCount = featureTable.length;

  const summary = {
    botanical_source: topBotanical?.botanical || 'Not determined',
    species: topBotanical?.species || '',
    family: topBotanical?.family || '',
    common_names: topBotanical?.commonNames?.join(', ') || '',
    authenticity_verdict: authenticity.verdict,
    confidence_score: authenticity.confidence,
    features_annotated: annotatedCount,
    features_total: totalCount,
    annotation_rate_pct: totalCount > 0 ? +((annotatedCount / totalCount) * 100).toFixed(1) : 0,
    literature_articles_found: literatureResults?.totalArticles || 0,
    pharmacopoeia_compliance: topBotanical?.pharmacopoeia || [],
    key_marker_compounds: topBotanical?.matchedMarkers?.slice(0, 5).map(m => m.marker) || [],
  };

  // Plain text narrative
  const lines = [
    `BOTANICAL SOURCE: ${summary.botanical_source}`,
    `Species: ${summary.species}`,
    `Authenticity: ${authenticity.verdict} (confidence: ${(authenticity.confidence * 100).toFixed(0)}%)`,
    `Annotation: ${annotatedCount}/${totalCount} features annotated (${summary.annotation_rate_pct}%)`,
    `Pharmacopoeia: ${summary.pharmacopoeia_compliance.join(', ') || 'N/A'}`,
    `Literature: ${summary.literature_articles_found} relevant articles found`,
    '',
    `Rationale: ${authenticity.reason}`,
  ];

  summary.narrative = lines.join('\n');
  return summary;
}

function buildQualityMetrics(featureTable, annotatedFeatures) {
  const cosineScores = featureTable.map(f => f.cosine_score).filter(s => s > 0);
  const avgCosine = cosineScores.length > 0
    ? +(cosineScores.reduce((a, b) => a + b, 0) / cosineScores.length).toFixed(4)
    : 0;
  const highConfidence = featureTable.filter(f => f.cosine_score >= 0.7).length;
  const mediumConfidence = featureTable.filter(f => f.cosine_score >= 0.5 && f.cosine_score < 0.7).length;
  const dbSources = [...new Set(featureTable.map(f => f.source_db).filter(Boolean))];

  return {
    total_features: featureTable.length,
    annotated_features: featureTable.filter(f => f.annotation !== 'Unknown').length,
    high_confidence_annotations: highConfidence,
    medium_confidence_annotations: mediumConfidence,
    average_cosine_score: avgCosine,
    databases_queried: dbSources,
    mz_tolerance_ppm: 10,
    cosine_threshold: 0.5,
    spectral_library_sources: ['GNPS', 'MassBank', 'Internal PhytochemDB'],
  };
}

function getConfirmatoryTests(authenticity, botanical) {
  const tests = [];

  if (!authenticity.authentic || authenticity.verdict === 'QUESTIONABLE') {
    tests.push('Authentic reference standard comparison by NMR');
    tests.push('Multi-reaction monitoring (MRM) LC-MS/MS quantification of marker compounds');
  }

  if (authenticity.flags?.some(f => f.includes('adulterant'))) {
    tests.push('Targeted adulterant screening by LC-MS/MS');
    tests.push('DNA barcoding for species identification');
    tests.push('Stable isotope ratio analysis (SIRA) for geographic origin');
  }

  if (botanical?.pharmacopoeia?.length > 0) {
    tests.push(`Pharmacopoeia ${botanical.pharmacopoeia.join('/')} assay methods`);
    tests.push('HPLC fingerprint comparison with pharmacopoeia reference extract');
  }

  if (authenticity.missingMarkers?.length > 0) {
    tests.push(`Targeted analysis for missing markers: ${authenticity.missingMarkers.slice(0, 3).join(', ')}`);
  }

  tests.push('Elemental analysis (ICP-MS) for heavy metal contamination');

  return tests;
}

/**
 * Format report as human-readable text for console output.
 */
export function formatReportAsText(report) {
  const sep = '═'.repeat(80);
  const line = '─'.repeat(80);
  const lines = [];

  lines.push(sep);
  lines.push('  LC-MS METABOLOMICS BOTANICAL ANNOTATION REPORT');
  lines.push(`  Generated: ${report.report_metadata.generated_at}`);
  lines.push(`  Processing time: ${report.report_metadata.processing_time_sec}s`);
  lines.push(sep);

  // Sample metadata
  lines.push('\nSAMPLE METADATA');
  lines.push(line);
  lines.push(`  File:       ${report.sample_metadata.file}`);
  lines.push(`  Polarity:   ${report.sample_metadata.polarity}`);
  lines.push(`  Instrument: ${report.sample_metadata.instrument_model} (${report.sample_metadata.instrument_manufacturer})`);
  lines.push(`  Ionisation: ${report.sample_metadata.ionisation}`);
  lines.push(`  Scans:      MS1=${report.sample_metadata.ms1_scans}, MS2=${report.sample_metadata.ms2_scans}`);
  lines.push(`  Features:   ${report.sample_metadata.features_with_ms2} with MS2 | ${report.sample_metadata.features_processed} processed`);

  // Executive summary
  lines.push('\nEXECUTIVE SUMMARY');
  lines.push(line);
  lines.push(report.executive_summary.narrative);

  // Authenticity
  lines.push('\nAUTHENTICITY ASSESSMENT');
  lines.push(line);
  const auth = report.authenticity_assessment;
  const verdict = formatVerdict(auth.verdict);
  lines.push(`  Verdict:    ${verdict}`);
  lines.push(`  Confidence: ${(auth.confidence * 100).toFixed(0)}%`);
  lines.push(`  Coverage:   ${auth.coverage_pct}% of expected markers detected`);
  if (auth.matched_markers?.length > 0)
    lines.push(`  Matched:    ${auth.matched_markers.join(', ')}`);
  if (auth.missing_markers?.length > 0)
    lines.push(`  Missing:    ${auth.missing_markers.join(', ')}`);
  if (auth.flags?.length > 0)
    lines.push(`  Flags:      ${auth.flags.join(', ')}`);
  lines.push(`  Rationale:  ${auth.rationale}`);

  if (auth.recommended_confirmatory_tests?.length > 0) {
    lines.push('\n  Recommended Confirmatory Tests:');
    for (const test of auth.recommended_confirmatory_tests) {
      lines.push(`    • ${test}`);
    }
  }

  // Botanical candidates
  lines.push('\nBOTANICAL IDENTIFICATION CANDIDATES');
  lines.push(line);
  for (const b of report.botanical_identification.candidates) {
    lines.push(`  [#${b.rank}] ${b.botanical}`);
    lines.push(`       Species: ${b.species} | Family: ${b.family}`);
    lines.push(`       Score: ${(b.score * 100).toFixed(1)}% | Coverage: ${b.coverage_pct}%`);
    lines.push(`       Matched markers: ${b.matched_markers || 'none'}`);
    lines.push(`       Pharmacopoeia: ${b.pharmacopoeia || 'N/A'}`);
    if (b.known_adulterants) lines.push(`       Known adulterants: ${b.known_adulterants}`);
    lines.push('');
  }

  // Feature annotation table (top 20)
  lines.push('FEATURE ANNOTATION TABLE (Top 20 by intensity)');
  lines.push(line);
  lines.push(
    '  ' + [
      'Feature', 'm/z', 'RT(min)', 'Annotation', 'Formula', 'Cosine', 'Source', 'DB'
    ].map(h => h.padEnd(14)).join('')
  );
  lines.push('  ' + '─'.repeat(112));

  for (const f of report.feature_annotations.slice(0, 20)) {
    const cols = [
      f.feature_id.padEnd(14),
      f.mz.toFixed(4).padEnd(14),
      f.rt_min.toFixed(2).padEnd(14),
      (f.annotation || 'Unknown').slice(0, 20).padEnd(22),
      (f.formula || '').padEnd(14),
      (f.cosine_score || 0).toFixed(3).padEnd(14),
      (f.source_db || '').padEnd(14),
      (f.pubchem_cid ? `CID:${f.pubchem_cid}` : f.hmdb_id || '').padEnd(14),
    ];
    lines.push('  ' + cols.join(''));
  }

  // Literature
  lines.push('\nLITERATURE REFERENCES (Top 10)');
  lines.push(line);
  for (const ref of report.literature_references.slice(0, 10)) {
    lines.push(`  [${ref.year || '----'}] ${ref.title}`);
    lines.push(`         ${ref.authors} | ${ref.journal}`);
    if (ref.doi) lines.push(`         DOI: ${ref.doi}`);
    if (ref.botanicals_mentioned) lines.push(`         Botanicals: ${ref.botanicals_mentioned}`);
    lines.push('');
  }

  // Quality metrics
  lines.push('QUALITY METRICS');
  lines.push(line);
  const qm = report.quality_metrics;
  lines.push(`  Annotated: ${qm.annotated_features}/${qm.total_features} features`);
  lines.push(`  High confidence (≥0.7): ${qm.high_confidence_annotations}`);
  lines.push(`  Medium confidence (0.5-0.7): ${qm.medium_confidence_annotations}`);
  lines.push(`  Average cosine score: ${qm.average_cosine_score}`);
  lines.push(`  Databases queried: ${qm.databases_queried.join(', ')}`);
  lines.push(`  Spectral libraries: ${qm.spectral_library_sources.join(', ')}`);
  lines.push(`  Mass tolerance: ${qm.mz_tolerance_ppm} ppm`);
  lines.push('');
  lines.push(sep);

  return lines.join('\n');
}

function formatVerdict(verdict) {
  const map = {
    'AUTHENTIC': '✅ AUTHENTIC',
    'LIKELY_AUTHENTIC': '✅ LIKELY AUTHENTIC',
    'AUTHENTIC_WITH_ADULTERANT_CONCERN': '⚠️  AUTHENTIC (Adulterant Concern)',
    'QUESTIONABLE': '⚠️  QUESTIONABLE',
    'NOT_AUTHENTIC': '❌ NOT AUTHENTIC',
    'UNDETERMINED': '❓ UNDETERMINED',
  };
  return map[verdict] || verdict;
}
