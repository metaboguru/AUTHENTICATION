#!/usr/bin/env node
/**
 * LC-MS Metabolomics Annotation CLI
 * Powered by Ruflo multi-agent orchestration (claude-flow@alpha)
 *
 * Usage:
 *   node scripts/annotate.js --input sample.mzXML [--polarity POS|NEG] [--output ./results] [--verbose]
 *   node scripts/annotate.js --help
 *
 * Example:
 *   node scripts/annotate.js --input data/green_tea.mzXML --polarity NEG --verbose
 */

import { program } from 'commander';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, basename, extname } from 'path';
import { createWriteStream } from 'fs';

// Progress bar
import { MultiBar, Presets } from 'cli-progress';

import { runWorkflow } from '../src/workflow/orchestrator.js';
import { formatReportAsText } from '../src/reports/report-generator.js';

program
  .name('lcms-annotate')
  .description('High-resolution LC-MS/MS metabolomics annotation & botanical identification')
  .version('1.0.0')
  .requiredOption('-i, --input <path>', 'Path to mzXML input file')
  .option('-p, --polarity <POS|NEG>', 'Override polarity detection (auto-detected if omitted)')
  .option('-o, --output <dir>', 'Output directory', './output')
  .option('-n, --max-features <number>', 'Maximum features to process', '50')
  .option('-v, --verbose', 'Verbose logging', false)
  .option('--json', 'Output JSON report to stdout (no console progress)', false)
  .option('--demo', 'Run with synthetic demo data (no real mzXML needed)', false)
  .parse(process.argv);

const opts = program.opts();

async function main() {
  const inputFile = opts.input;
  const polarity = opts.polarity?.toUpperCase() || null;
  const outputDir = opts.output;
  const maxFeatures = parseInt(opts.maxFeatures) || 50;
  const verbose = opts.verbose;
  const jsonMode = opts.json;
  const demoMode = opts.demo;

  if (!demoMode && !existsSync(inputFile)) {
    console.error(`❌ Error: Input file not found: ${inputFile}`);
    process.exit(1);
  }

  if (polarity && !['POS', 'NEG'].includes(polarity)) {
    console.error('❌ Error: Polarity must be POS or NEG');
    process.exit(1);
  }

  // Setup output directory
  mkdirSync(outputDir, { recursive: true });

  // Demo mode: use synthetic demo mzXML
  const actualInput = demoMode ? await createDemoMzXML(outputDir) : inputFile;

  if (!jsonMode) {
    console.log('\n╔══════════════════════════════════════════════════════════════╗');
    console.log('║     LC-MS Metabolomics Workflow — Ruflo Multi-Agent AI       ║');
    console.log('║     Botanical Identification & Authenticity Assessment        ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n  Input:    ${actualInput}`);
    console.log(`  Polarity: ${polarity || 'auto-detect'}`);
    console.log(`  Output:   ${outputDir}`);
    console.log(`  Features: up to ${maxFeatures}`);
    console.log('\n  Agents: Spectral Matcher • DB Annotator • Literature Searcher');
    console.log('          Botanical Identifier • Authenticity Assessor\n');
  }

  // Progress tracking
  let progressBar = null;
  if (!jsonMode && !verbose) {
    const bars = new MultiBar({
      clearOnComplete: false,
      hideCursor: true,
      format: '  [{bar}] {percentage}% | {step}',
    }, Presets.shades_classic);
    progressBar = bars.create(100, 0, { step: 'Initializing...' });
  }

  const onProgress = ({ step, pct }) => {
    if (progressBar) progressBar.update(pct, { step });
    else if (!jsonMode) console.log(`  [${pct}%] ${step}`);
  };

  try {
    const report = await runWorkflow(actualInput, {
      polarity,
      verbose,
      outputDir,
      maxFeatures,
      onProgress,
    });

    if (progressBar) {
      progressBar.update(100, { step: 'Complete!' });
      progressBar.stop();
    }

    // Save JSON report
    const baseName = basename(actualInput, extname(actualInput));
    const jsonPath = join(outputDir, `${baseName}_annotation_report.json`);
    writeFileSync(jsonPath, JSON.stringify(report, null, 2), 'utf-8');

    // Save text report
    const textReport = formatReportAsText(report);
    const textPath = join(outputDir, `${baseName}_annotation_report.txt`);
    writeFileSync(textPath, textReport, 'utf-8');

    if (jsonMode) {
      process.stdout.write(JSON.stringify(report, null, 2));
    } else {
      console.log('\n' + textReport);
      console.log(`\n📁 Reports saved to:`);
      console.log(`   JSON: ${jsonPath}`);
      console.log(`   Text: ${textPath}`);
    }

  } catch (err) {
    if (progressBar) progressBar.stop();
    console.error('\n❌ Workflow error:', err.message);
    if (verbose) console.error(err.stack);
    process.exit(1);
  }
}

/**
 * Create a synthetic demo mzXML file with known phytochemicals.
 * Contains markers consistent with green tea (Camellia sinensis).
 */
async function createDemoMzXML(outputDir) {
  const path = join(outputDir, 'demo_green_tea_NEG.mzXML');

  // Synthetic NEG mode green tea markers
  // [M-H]- ions: EGCG(457.077), EGC(305.066), EC(289.071), caffeine not in NEG, theanine(173.094)
  const demoXml = `<?xml version="1.0" encoding="ISO-8859-1"?>
<mzXML xmlns="http://sashimi.sourceforge.net/schema_revision/mzXML_3.2"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://sashimi.sourceforge.net/schema_revision/mzXML_3.2 http://sashimi.sourceforge.net/schema_revision/mzXML_3.2/mzXML_idx_3.2.xsd">
  <msRun scanCount="8" startTime="PT0.5S" endTime="PT900S">
    <msInstrument>
      <msManufacturer category="msManufacturer" value="Thermo Scientific"/>
      <msModel category="msModel" value="Q Exactive HF"/>
      <msIonisation category="msIonisation" value="ESI"/>
      <msMassAnalyzer category="msMassAnalyzer" value="Orbitrap"/>
      <msDetector category="msDetector" value="Orbitrap"/>
    </msInstrument>
    <scan num="1" msLevel="1" peaksCount="6" polarity="-" retentionTime="PT120S"
          basePeakMz="457.0774" basePeakIntensity="1850000" totIonCurrent="5200000"
          lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
    <scan num="2" msLevel="2" peaksCount="12" polarity="-" retentionTime="PT121S"
          basePeakMz="169.014" basePeakIntensity="650000" totIonCurrent="1800000"
          lowMz="50" highMz="460" collisionEnergy="25">
      <precursorMz precursorIntensity="1850000" precursorCharge="1">457.0774</precursorMz>
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
    <scan num="3" msLevel="1" peaksCount="5" polarity="-" retentionTime="PT180S"
          basePeakMz="289.0714" basePeakIntensity="980000" totIonCurrent="3100000"
          lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
    <scan num="4" msLevel="2" peaksCount="10" polarity="-" retentionTime="PT181S"
          basePeakMz="245.045" basePeakIntensity="420000" totIonCurrent="1100000"
          collisionEnergy="25">
      <precursorMz precursorIntensity="980000" precursorCharge="1">289.0714</precursorMz>
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
    <scan num="5" msLevel="1" peaksCount="4" polarity="-" retentionTime="PT240S"
          basePeakMz="353.088" basePeakIntensity="720000" totIonCurrent="2100000"
          lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
    <scan num="6" msLevel="2" peaksCount="9" polarity="-" retentionTime="PT241S"
          basePeakMz="191.056" basePeakIntensity="380000" totIonCurrent="950000"
          collisionEnergy="30">
      <precursorMz precursorIntensity="720000" precursorCharge="1">353.088</precursorMz>
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
    <scan num="7" msLevel="1" peaksCount="3" polarity="-" retentionTime="PT300S"
          basePeakMz="173.094" basePeakIntensity="540000" totIonCurrent="1400000"
          lowMz="100" highMz="1000">
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
    <scan num="8" msLevel="2" peaksCount="7" polarity="-" retentionTime="PT301S"
          basePeakMz="84.045" basePeakIntensity="290000" totIonCurrent="720000"
          collisionEnergy="20">
      <precursorMz precursorIntensity="540000" precursorCharge="1">173.094</precursorMz>
      <peaks precision="32" byteOrder="network" contentType="m/z-int">AAAAAAAAAAAAAAAAAAAAAAAA</peaks>
    </scan>
  </msRun>
</mzXML>`;

  writeFileSync(path, demoXml, 'utf-8');
  console.log(`  [Demo] Synthetic green tea mzXML created: ${path}`);
  return path;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
