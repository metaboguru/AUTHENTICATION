/**
 * mzXML Parser — extracts MS1 and MS2 spectra from high-resolution LC-MS data.
 * Supports both positive (POS) and negative (NEG) polarity.
 * Handles Thermo, Waters, Bruker, Agilent mzXML output formats.
 */

import { XMLParser } from 'fast-xml-parser';
import { readFileSync } from 'fs';

const POLARITY_MAP = { '+': 'POS', '-': 'NEG', 'positive': 'POS', 'negative': 'NEG' };

/**
 * Decode base64-encoded peak data from mzXML scan.
 * mzXML stores m/z and intensity as interleaved 32-bit or 64-bit floats.
 */
function decodePeaks(peakData, precision = 32, byteOrder = 'network') {
  if (!peakData) return [];
  const raw = Buffer.from(peakData.trim(), 'base64');
  const bytesPerFloat = precision === 64 ? 8 : 4;
  const count = Math.floor(raw.length / bytesPerFloat);
  const values = [];

  for (let i = 0; i < count; i++) {
    const offset = i * bytesPerFloat;
    const val = precision === 64
      ? raw.readDoubleBE(offset)
      : raw.readFloatBE(offset);
    values.push(val);
  }

  // Interleaved: [mz0, int0, mz1, int1, ...]
  const peaks = [];
  for (let i = 0; i < values.length - 1; i += 2) {
    const mz = values[i];
    const intensity = values[i + 1];
    if (mz > 0 && intensity > 0) {
      peaks.push({ mz: +mz.toFixed(6), intensity: +intensity.toFixed(2) });
    }
  }
  return peaks;
}

/**
 * Parse a single scan element from mzXML.
 */
function parseScan(scan, parentPrecursor = null) {
  const attrs = scan[':@'] || {};
  const num = parseInt(attrs.num || scan.num || 0);
  const msLevel = parseInt(attrs.msLevel || scan.msLevel || 1);
  const retentionTime = parseRetentionTime(attrs.retentionTime || scan.retentionTime || 'PT0S');
  const polarityRaw = attrs.polarity || scan.polarity || '+';
  const polarity = POLARITY_MAP[polarityRaw] || POLARITY_MAP[polarityRaw.toLowerCase()] || 'POS';
  const peaksCount = parseInt(attrs.peaksCount || scan.peaksCount || 0);

  // Extract peaks
  let peaks = [];
  let precision = 32;
  let peakData = null;

  const peaksEl = scan.peaks;
  if (peaksEl) {
    if (Array.isArray(peaksEl)) {
      const pe = peaksEl[0];
      precision = parseInt(pe[':@']?.precision || pe.precision || 32);
      peakData = pe['#text'] || pe._text || pe['$t'] || (typeof pe === 'string' ? pe : null);
    } else if (typeof peaksEl === 'object') {
      precision = parseInt(peaksEl[':@']?.precision || peaksEl.precision || 32);
      peakData = peaksEl['#text'] || peaksEl._text || (typeof peaksEl === 'string' ? peaksEl : null);
    } else {
      peakData = String(peaksEl);
    }
    if (peakData) {
      peaks = decodePeaks(peakData, precision);
    }
  }

  const result = {
    num,
    msLevel,
    retentionTime,
    polarity,
    peaksCount: peaks.length || peaksCount,
    peaks,
    basePeakMz: parseFloat(attrs.basePeakMz || scan.basePeakMz || 0),
    basePeakIntensity: parseFloat(attrs.basePeakIntensity || scan.basePeakIntensity || 0),
    totalIonCurrent: parseFloat(attrs.totIonCurrent || scan.totIonCurrent || 0),
    lowMz: parseFloat(attrs.lowMz || scan.lowMz || 0),
    highMz: parseFloat(attrs.highMz || scan.highMz || 0),
  };

  // MS2-specific fields
  if (msLevel >= 2) {
    const precursorEl = scan.precursorMz;
    let precursorMz = parentPrecursor;
    let precursorIntensity = 0;
    let collisionEnergy = parseFloat(attrs.collisionEnergy || scan.collisionEnergy || 0);

    if (precursorEl) {
      if (Array.isArray(precursorEl)) {
        const pe = precursorEl[0];
        precursorMz = parseFloat(pe['#text'] || pe._text || pe || 0);
        precursorIntensity = parseFloat(pe[':@']?.precursorIntensity || pe.precursorIntensity || 0);
      } else if (typeof precursorEl === 'object') {
        precursorMz = parseFloat(precursorEl['#text'] || precursorEl._text || 0);
        precursorIntensity = parseFloat(precursorEl[':@']?.precursorIntensity || precursorEl.precursorIntensity || 0);
      } else {
        precursorMz = parseFloat(String(precursorEl));
      }
    }

    result.precursorMz = precursorMz;
    result.precursorIntensity = precursorIntensity;
    result.collisionEnergy = collisionEnergy;
    result.filterLine = attrs.filterLine || scan.filterLine || '';
  }

  // Recursively parse nested MS2/MS3 scans
  result.childScans = [];
  const children = scan.scan || [];
  const childArr = Array.isArray(children) ? children : [children];
  for (const child of childArr) {
    if (child && typeof child === 'object') {
      result.childScans.push(parseScan(child, result.basePeakMz));
    }
  }

  return result;
}

function parseRetentionTime(rtStr) {
  if (!rtStr) return 0;
  // ISO 8601 duration: PT1.5S, PT1M30.5S
  const match = String(rtStr).match(/PT(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (match) {
    const mins = parseFloat(match[1] || 0);
    const secs = parseFloat(match[2] || 0);
    return +(mins * 60 + secs).toFixed(4);
  }
  // Plain number (seconds)
  return parseFloat(rtStr) || 0;
}

/**
 * Main parse function. Returns structured data from mzXML file.
 * @param {string} filePath  — absolute path to .mzXML file
 * @param {string} [forcedPolarity] — 'POS' | 'NEG' | null (auto-detect)
 */
export async function parseMzXML(filePath, forcedPolarity = null) {
  const xml = readFileSync(filePath, 'utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: true,
    allowBooleanAttributes: true,
    parseTagValue: true,
    cdataPropName: '#text',
    textNodeName: '#text',
    isArray: (name) => ['scan', 'peaks', 'precursorMz', 'nameValue', 'msInstrument'].includes(name),
  });

  const doc = parser.parse(xml);
  const mzXML = doc.mzXML || doc.indexedmzXML || Object.values(doc)[0];
  const msRun = mzXML?.msRun || mzXML;

  // Instrument metadata
  const instrument = extractInstrument(msRun);
  const msScans = msRun?.scan || [];
  const scanArr = Array.isArray(msScans) ? msScans : [msScans];

  const ms1Scans = [];
  const ms2Scans = [];
  let detectedPolarity = null;

  for (const rawScan of scanArr) {
    if (!rawScan || typeof rawScan !== 'object') continue;
    const scan = parseScan(rawScan);

    // Determine polarity
    if (!detectedPolarity && scan.polarity) {
      detectedPolarity = scan.polarity;
    }

    if (scan.msLevel === 1) {
      ms1Scans.push(scan);
      // Collect nested MS2
      for (const child of scan.childScans) {
        ms2Scans.push({ ...child, parentScanNum: scan.num });
      }
    } else if (scan.msLevel === 2) {
      ms2Scans.push(scan);
    }
  }

  const polarity = forcedPolarity || detectedPolarity || 'POS';

  // Build feature list: group MS2 by precursor m/z (within 5 ppm)
  const features = buildFeatureList(ms1Scans, ms2Scans, polarity);

  return {
    metadata: {
      filePath,
      polarity,
      instrument,
      totalScans: scanArr.length,
      ms1Count: ms1Scans.length,
      ms2Count: ms2Scans.length,
      featureCount: features.length,
      rtRange: ms1Scans.length > 0
        ? [ms1Scans[0].retentionTime, ms1Scans[ms1Scans.length - 1].retentionTime]
        : [0, 0],
    },
    ms1Scans,
    ms2Scans,
    features,
  };
}

function extractInstrument(msRun) {
  const inst = msRun?.msInstrument;
  if (!inst) return { manufacturer: 'Unknown', model: 'Unknown', ionisation: 'ESI', analyzer: 'Unknown' };
  const arr = Array.isArray(inst) ? inst : [inst];
  const i = arr[0] || {};
  return {
    manufacturer: i.manufacturer || i['msManufacturer'] || 'Unknown',
    model: i.model || i['msModel'] || 'Unknown',
    ionisation: i.ionisation || i['msIonisation'] || 'ESI',
    analyzer: i.msMassAnalyzer || i.analyzer || 'Unknown',
    detector: i.msDetector || i.detector || 'Unknown',
  };
}

/**
 * Group MS1 features with their MS2 spectra.
 * Cluster MS2 scans to MS1 peaks by precursor m/z tolerance (5 ppm) and RT proximity.
 */
function buildFeatureList(ms1Scans, ms2Scans, polarity) {
  const features = new Map(); // key: rounded mz string

  // Extract MS1 features (top N peaks per scan)
  for (const scan of ms1Scans) {
    const topPeaks = scan.peaks
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 50);

    for (const peak of topPeaks) {
      const key = Math.round(peak.mz * 1000) / 1000;
      if (!features.has(key)) {
        features.set(key, {
          mz: peak.mz,
          rt: scan.retentionTime,
          intensity: peak.intensity,
          polarity,
          ms2Spectra: [],
          rtList: [scan.retentionTime],
          intensityList: [peak.intensity],
        });
      } else {
        const f = features.get(key);
        f.rtList.push(scan.retentionTime);
        f.intensityList.push(peak.intensity);
        if (peak.intensity > f.intensity) {
          f.intensity = peak.intensity;
          f.rt = scan.retentionTime;
        }
      }
    }
  }

  // Assign MS2 scans to features
  for (const ms2 of ms2Scans) {
    if (!ms2.precursorMz || ms2.peaks.length === 0) continue;

    let bestMatch = null;
    let bestPpm = 10; // 10 ppm tolerance

    for (const [key, feature] of features) {
      const ppm = Math.abs(ms2.precursorMz - feature.mz) / feature.mz * 1e6;
      if (ppm < bestPpm) {
        bestPpm = ppm;
        bestMatch = feature;
      }
    }

    if (bestMatch) {
      bestMatch.ms2Spectra.push({
        scanNum: ms2.num,
        retentionTime: ms2.retentionTime,
        collisionEnergy: ms2.collisionEnergy,
        peaks: ms2.peaks,
        precursorMz: ms2.precursorMz,
      });
    }
  }

  // Convert to array, filter features that have MS2
  return Array.from(features.values())
    .filter(f => f.ms2Spectra.length > 0)
    .sort((a, b) => b.intensity - a.intensity);
}

/**
 * Calculate ppm mass error between observed and theoretical m/z.
 */
export function ppmError(observed, theoretical) {
  return Math.abs(observed - theoretical) / theoretical * 1e6;
}

/**
 * Calculate neutral mass from observed m/z and adduct.
 * polarity: 'POS' | 'NEG'
 */
export function neutralMass(mz, adduct, polarity) {
  const ADDUCTS = {
    POS: {
      '[M+H]+':    { mult: 1, add: -1.007276 },
      '[M+Na]+':   { mult: 1, add: -22.989218 },
      '[M+K]+':    { mult: 1, add: -38.963158 },
      '[M+NH4]+':  { mult: 1, add: -18.034164 },
      '[M+2H]2+':  { mult: 2, add: -2.014552 },
      '[M+H-H2O]+':{ mult: 1, add: 16.018724 },
      '[M]+':      { mult: 1, add: -0.000549 },
    },
    NEG: {
      '[M-H]-':    { mult: 1, add: 1.007276 },
      '[M+Cl]-':   { mult: 1, add: -34.969402 },
      '[M+HCOO]-': { mult: 1, add: -44.998201 },
      '[M+CH3COO]-':{ mult: 1, add: -59.013851 },
      '[M-2H]2-':  { mult: 2, add: 2.014552 },
      '[M-H-H2O]-':{ mult: 1, add: 19.01840 },
    },
  };

  const map = ADDUCTS[polarity] || ADDUCTS.POS;
  const info = map[adduct];
  if (!info) return mz;
  return +(mz * info.mult + info.add).toFixed(6);
}
