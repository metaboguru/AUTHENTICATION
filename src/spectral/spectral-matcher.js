/**
 * Spectral Matching Engine
 * Implements cosine similarity matching against GNPS and MassBank REST APIs.
 * Also performs in-memory library search against built-in phytochemical spectral library.
 *
 * References:
 *  - GNPS API: https://gnps.ucsd.edu/ProteoSAFe/librarysearch
 *  - MassBank REST: https://massbank.eu/MassBank/api/
 *  - Wang et al. (2016) Nature Biotechnology - GNPS
 *  - Horai et al. (2010) J Mass Spectrom - MassBank
 */

import fetch from 'node-fetch';

const GNPS_API = 'https://gnps-structure.ucsd.edu';
const MASSBANK_API = 'https://massbank.eu/MassBank/api';
const MZ_TOLERANCE_PPM = 10;
const MIN_COSINE_SCORE = 0.5;
const MIN_MATCHED_PEAKS = 3;

/**
 * Cosine similarity between two MS2 spectra.
 * Implements weighted dot-product cosine (Bray & Curtis normalization).
 * peaks: [{mz, intensity}]
 */
export function cosineSimilarity(queryPeaks, libPeaks, mzTolPpm = MZ_TOLERANCE_PPM) {
  if (!queryPeaks?.length || !libPeaks?.length) return { score: 0, matchedPeaks: 0 };

  // Normalize intensities (square-root transform to reduce dynamic range)
  const normQuery = normalizePeaks(queryPeaks);
  const normLib = normalizePeaks(libPeaks);

  let dotProduct = 0;
  let matchedPeaks = 0;
  const matched = new Set();

  for (const qp of normQuery) {
    for (let j = 0; j < normLib.length; j++) {
      if (matched.has(j)) continue;
      const lp = normLib[j];
      const ppm = Math.abs(qp.mz - lp.mz) / lp.mz * 1e6;
      if (ppm <= mzTolPpm) {
        dotProduct += qp.normInt * lp.normInt;
        matchedPeaks++;
        matched.add(j);
        break;
      }
    }
  }

  const queryNorm = normQuery.reduce((s, p) => s + p.normInt ** 2, 0) ** 0.5;
  const libNorm = normLib.reduce((s, p) => s + p.normInt ** 2, 0) ** 0.5;
  const score = queryNorm > 0 && libNorm > 0 ? dotProduct / (queryNorm * libNorm) : 0;

  return { score: +score.toFixed(4), matchedPeaks };
}

function normalizePeaks(peaks) {
  const maxInt = Math.max(...peaks.map(p => p.intensity));
  if (maxInt === 0) return [];
  return peaks.map(p => ({
    mz: p.mz,
    intensity: p.intensity,
    normInt: Math.sqrt(p.intensity / maxInt),
  }));
}

/**
 * Query GNPS spectral library via REST API.
 * Returns top matches with compound metadata.
 */
export async function queryGNPS(precursorMz, ms2Peaks, polarity, mzTol = 0.02) {
  try {
    // GNPS library search endpoint
    const url = `${GNPS_API}/gnpslibrary`;
    const peakStr = ms2Peaks
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 50)
      .map(p => `${p.mz}:${p.intensity}`)
      .join(' ');

    // Use GNPS direct library search
    const searchUrl = `https://gnps-external.ucsd.edu/gnpslibraryjsonp?` +
      `peaks=${encodeURIComponent(peakStr)}` +
      `&precursor_mz=${precursorMz}` +
      `&charge=1` +
      `&polarity=${polarity === 'POS' ? 'positive' : 'negative'}` +
      `&mz_tol=${mzTol}` +
      `&min_cosine=0.5` +
      `&analog=0` +
      `&max_results=10`;

    const resp = await fetchWithTimeout(searchUrl, 15000);
    if (!resp.ok) return [];

    const data = await resp.json();
    const hits = Array.isArray(data) ? data : (data.results || data.hits || []);

    return hits.slice(0, 10).map(h => ({
      source: 'GNPS',
      name: h.Compound_Name || h.compound_name || h.name || 'Unknown',
      inchiKey: h.InChIKey || h.inchikey || '',
      smiles: h.Smiles || h.smiles || '',
      formula: h.MolecularFormula || h.molecular_formula || '',
      exactMass: parseFloat(h.ExactMass || h.exact_mass || 0),
      cosineScore: parseFloat(h.MQScore || h.cosine || h.score || 0),
      matchedPeaks: parseInt(h.SharedPeaks || h.matched_peaks || 0),
      libraryId: h.spectrum_id || h.SpectrumID || h.library_id || '',
      ionMode: h.Ion_Mode || polarity,
      superClass: h.Superclass || '',
      classEl: h.Class || '',
      subClass: h.Subclass || '',
      adduct: h.Adduct || (polarity === 'POS' ? '[M+H]+' : '[M-H]-'),
      kingdom: h.Kingdom || '',
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Query MassBank REST API.
 */
export async function queryMassBank(precursorMz, ms2Peaks, polarity) {
  try {
    const peakStr = ms2Peaks
      .sort((a, b) => b.intensity - a.intensity)
      .slice(0, 40)
      .map(p => `${p.mz.toFixed(4)}\t${p.intensity.toFixed(0)}`)
      .join('\n');

    const body = new URLSearchParams({
      peaks: peakStr,
      precursor: precursorMz.toFixed(4),
      type: polarity === 'POS' ? 'P' : 'N',
      tol: '0.01',
      cutoff: '0.5',
      limit: '10',
    });

    const resp = await fetchWithTimeout(`${MASSBANK_API}/similarity/search`, 15000, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!resp.ok) return [];
    const data = await resp.json();
    const results = data.results || data || [];

    return results.slice(0, 10).map(r => ({
      source: 'MassBank',
      name: r.compound?.names?.[0] || r.name || 'Unknown',
      inchiKey: r.compound?.inchiKey || r.inchiKey || '',
      smiles: r.compound?.smiles || r.smiles || '',
      formula: r.compound?.formula || r.formula || '',
      exactMass: parseFloat(r.compound?.mass || r.mass || 0),
      cosineScore: parseFloat(r.score || r.similarity || 0),
      matchedPeaks: parseInt(r.matchedPeaks || 0),
      libraryId: r.accession || r.id || '',
      ionMode: polarity,
      adduct: r.metadata?.find(m => m.name === 'precursor_type')?.value || '',
    }));
  } catch (err) {
    return [];
  }
}

/**
 * In-memory spectral library for common phytochemicals.
 * Contains diagnostic fragment ions for major plant metabolite classes.
 * Sources: DNP, KNApSAcK, HMDB, published literature.
 */
const PHYTOCHEMICAL_LIBRARY = {
  // Flavonoids
  quercetin:         { formula: 'C15H10O7', mass: 302.0427, fragments_pos: [153.019, 229.051, 303.050, 137.024], fragments_neg: [151.004, 179.000, 271.025] },
  kaempferol:        { formula: 'C15H10O6', mass: 286.0477, fragments_pos: [153.019, 213.056, 287.055, 121.029], fragments_neg: [151.004, 255.030] },
  luteolin:          { formula: 'C15H10O6', mass: 286.0477, fragments_pos: [153.019, 137.024, 287.055], fragments_neg: [151.004, 175.040] },
  apigenin:          { formula: 'C15H10O5', mass: 270.0528, fragments_pos: [153.019, 121.029, 271.061], fragments_neg: [117.035, 151.004] },
  rutin:             { formula: 'C27H30O16', mass: 610.1534, fragments_pos: [303.050, 465.103, 147.066], fragments_neg: [300.027, 271.024, 151.004] },
  naringenin:        { formula: 'C15H12O5', mass: 272.0685, fragments_pos: [153.019, 119.050, 273.076], fragments_neg: [151.004, 177.056] },
  hesperidin:        { formula: 'C28H34O15', mass: 610.1953, fragments_pos: [303.086, 287.091, 153.054], fragments_neg: [300.062, 271.060] },
  catechin:          { formula: 'C15H14O6', mass: 290.0790, fragments_pos: [139.040, 123.045, 291.086], fragments_neg: [245.045, 179.035] },
  epicatechin:       { formula: 'C15H14O6', mass: 290.0790, fragments_pos: [139.040, 123.045, 291.086], fragments_neg: [245.045, 179.035] },
  myricetin:         { formula: 'C15H10O8', mass: 318.0376, fragments_pos: [169.013, 153.019, 319.045], fragments_neg: [317.031, 179.000] },
  // Phenolic acids
  chlorogenic_acid:  { formula: 'C16H18O9', mass: 354.0951, fragments_pos: [163.039, 145.029, 355.102], fragments_neg: [191.056, 179.035, 135.045] },
  caffeic_acid:      { formula: 'C9H8O4',  mass: 180.0423, fragments_pos: [163.039, 145.029], fragments_neg: [135.045, 179.035] },
  ferulic_acid:      { formula: 'C10H10O4', mass: 194.0579, fragments_pos: [177.054, 149.059, 145.029], fragments_neg: [149.059, 134.037] },
  rosmarinic_acid:   { formula: 'C18H16O8', mass: 360.0845, fragments_pos: [163.039, 145.029, 361.092], fragments_neg: [197.045, 179.035, 161.024] },
  gallic_acid:       { formula: 'C7H6O5',  mass: 170.0215, fragments_pos: [153.019, 125.024], fragments_neg: [125.024, 169.014] },
  // Alkaloids
  caffeine:          { formula: 'C8H10N4O2', mass: 194.0804, fragments_pos: [137.046, 110.071, 195.088], fragments_neg: [] },
  theobromine:       { formula: 'C7H8N4O2', mass: 180.0647, fragments_pos: [163.061, 138.066, 181.072], fragments_neg: [] },
  berberine:         { formula: 'C20H18NO4', mass: 336.1236, fragments_pos: [320.093, 292.098, 278.081], fragments_neg: [] },
  colchicine:        { formula: 'C22H25NO6', mass: 399.1682, fragments_pos: [310.107, 282.113, 358.129], fragments_neg: [] },
  // Terpenoids
  ursolic_acid:      { formula: 'C30H48O3', mass: 456.3553, fragments_pos: [203.180, 247.170, 457.363], fragments_neg: [455.347, 411.357] },
  oleanolic_acid:    { formula: 'C30H48O3', mass: 456.3553, fragments_pos: [203.180, 248.178, 457.363], fragments_neg: [455.347, 411.357] },
  betulinic_acid:    { formula: 'C30H48O3', mass: 456.3553, fragments_pos: [189.164, 203.180, 457.363], fragments_neg: [455.347] },
  // Glycosides
  ginsenoside_rb1:   { formula: 'C54H92O23', mass: 1108.6142, fragments_pos: [361.196, 475.302, 637.435], fragments_neg: [945.550, 783.497] },
  // Curcuminoids
  curcumin:          { formula: 'C21H20O6', mass: 368.1260, fragments_pos: [177.054, 149.059, 369.133], fragments_neg: [367.119, 217.086] },
  // Stilbenes
  resveratrol:       { formula: 'C14H12O3', mass: 228.0786, fragments_pos: [143.049, 115.054, 229.086], fragments_neg: [227.071, 185.061] },
  // Coumarins
  umbelliferone:     { formula: 'C9H6O3', mass: 162.0317, fragments_pos: [107.050, 89.039, 163.039], fragments_neg: [161.024, 133.029] },
  // Iridoids
  oleuropein:        { formula: 'C25H32O13', mass: 540.1794, fragments_pos: [307.082, 377.123, 541.186], fragments_neg: [275.091, 307.082] },
};

/**
 * Match MS2 spectrum against built-in phytochemical library.
 */
export function matchPhytochemicalLibrary(precursorMz, ms2Peaks, polarity) {
  const results = [];
  const mainAdduct = polarity === 'POS' ? 1.007276 : -1.007276;

  for (const [name, compound] of Object.entries(PHYTOCHEMICAL_LIBRARY)) {
    // Check precursor mass match (10 ppm)
    const theoreticalMz = compound.mass + mainAdduct;
    const ppm = Math.abs(precursorMz - theoreticalMz) / theoreticalMz * 1e6;
    if (ppm > 10) continue;

    // Match diagnostic fragments
    const fragList = polarity === 'POS' ? compound.fragments_pos : compound.fragments_neg;
    if (!fragList?.length) continue;

    let matchedFrags = 0;
    for (const fragMz of fragList) {
      const found = ms2Peaks.some(p => Math.abs(p.mz - fragMz) / fragMz * 1e6 < 10);
      if (found) matchedFrags++;
    }

    if (matchedFrags >= Math.min(2, fragList.length)) {
      const score = matchedFrags / fragList.length;
      results.push({
        source: 'PhytochemDB',
        name: name.replace(/_/g, ' '),
        formula: compound.formula,
        exactMass: compound.mass,
        cosineScore: +score.toFixed(3),
        matchedPeaks: matchedFrags,
        totalFragments: fragList.length,
        ppmError: +ppm.toFixed(2),
        adduct: polarity === 'POS' ? '[M+H]+' : '[M-H]-',
        ionMode: polarity,
      });
    }
  }

  return results.sort((a, b) => b.cosineScore - a.cosineScore);
}

/**
 * Unified spectral search: queries all available sources and merges results.
 */
export async function spectralSearch(feature, verbose = false) {
  const { mz, ms2Spectra, polarity } = feature;
  if (!ms2Spectra?.length) return [];

  // Use best MS2 spectrum (highest total ion current)
  const bestMs2 = ms2Spectra.reduce((best, s) =>
    s.peaks.reduce((t, p) => t + p.intensity, 0) >
    best.peaks.reduce((t, p) => t + p.intensity, 0) ? s : best
  );

  const [gnpsResults, massBankResults, internalResults] = await Promise.all([
    queryGNPS(mz, bestMs2.peaks, polarity),
    queryMassBank(mz, bestMs2.peaks, polarity),
    Promise.resolve(matchPhytochemicalLibrary(mz, bestMs2.peaks, polarity)),
  ]);

  // Merge and deduplicate by InChIKey or name
  const all = [...internalResults, ...gnpsResults, ...massBankResults];
  const seen = new Map();

  for (const hit of all) {
    const key = hit.inchiKey || hit.name.toLowerCase();
    if (!seen.has(key) || seen.get(key).cosineScore < hit.cosineScore) {
      seen.set(key, hit);
    }
  }

  return Array.from(seen.values())
    .filter(h => h.cosineScore >= MIN_COSINE_SCORE || h.matchedPeaks >= MIN_MATCHED_PEAKS)
    .sort((a, b) => b.cosineScore - a.cosineScore)
    .slice(0, 15);
}

async function fetchWithTimeout(url, timeout = 10000, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
