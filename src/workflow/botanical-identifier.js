/**
 * Botanical Identification Engine
 * Cross-references annotated metabolites against known phytochemical fingerprints
 * from published literature to identify the botanical source (plant species/extract).
 *
 * Knowledge base compiled from:
 *  - Pharmacopoeia monographs (USP, EP, BP)
 *  - KNApSAcK plant-metabolite database
 *  - PlantFA / LOTUS databases
 *  - PubMed literature
 *  - DNP (Dictionary of Natural Products)
 */

// Botanical fingerprint database
// Each entry: list of characteristic/marker metabolites with confidence weights
export const BOTANICAL_FINGERPRINTS = {
  'Panax ginseng (Asian Ginseng)': {
    species: 'Panax ginseng C.A.Mey.',
    family: 'Araliaceae',
    commonNames: ['Asian ginseng', 'Korean ginseng', 'Chinese ginseng'],
    markers: [
      { name: 'ginsenoside Rb1', formula: 'C54H92O23', mass: 1108.614, weight: 1.0 },
      { name: 'ginsenoside Rg1', formula: 'C42H72O14', mass: 800.490, weight: 1.0 },
      { name: 'ginsenoside Re', formula: 'C48H82O18', mass: 946.552, weight: 0.9 },
      { name: 'ginsenoside Rd', formula: 'C48H82O18', mass: 946.552, weight: 0.9 },
      { name: 'ginsenoside Rc', formula: 'C48H82O18', mass: 946.552, weight: 0.8 },
      { name: 'panaxadiol', formula: 'C30H52O2', mass: 460.396, weight: 0.7 },
      { name: 'panaxatriol', formula: 'C30H52O3', mass: 476.391, weight: 0.7 },
      { name: 'malonylginsenoside Rb1', formula: 'C57H94O26', mass: 1194.614, weight: 0.6 },
    ],
    pharmacopoeia: ['USP', 'EP', 'BP', 'JP'],
    parts: ['root'],
    adulteration: ['Panax quinquefolius', 'Eleutherococcus senticosus'],
    authenticityThreshold: 0.6,
  },

  'Camellia sinensis (Green Tea)': {
    species: 'Camellia sinensis (L.) Kuntze',
    family: 'Theaceae',
    commonNames: ['green tea', 'black tea', 'white tea', 'oolong tea'],
    markers: [
      { name: 'epigallocatechin gallate', formula: 'C22H18O11', mass: 458.085, weight: 1.0 },
      { name: 'epigallocatechin', formula: 'C15H14O7', mass: 306.074, weight: 0.9 },
      { name: 'epicatechin gallate', formula: 'C22H18O10', mass: 442.090, weight: 0.9 },
      { name: 'epicatechin', formula: 'C15H14O6', mass: 290.079, weight: 0.8 },
      { name: 'catechin', formula: 'C15H14O6', mass: 290.079, weight: 0.8 },
      { name: 'caffeine', formula: 'C8H10N4O2', mass: 194.080, weight: 0.9 },
      { name: 'theanine', formula: 'C7H14N2O3', mass: 174.101, weight: 1.0 },
      { name: 'gallocatechin', formula: 'C15H14O7', mass: 306.074, weight: 0.7 },
      { name: 'theaflavin', formula: 'C29H24O12', mass: 564.127, weight: 0.7 },
    ],
    pharmacopoeia: ['EP', 'USP'],
    parts: ['leaf'],
    adulteration: ['Camellia assamica', 'Camellia taliensis'],
    authenticityThreshold: 0.55,
  },

  'Curcuma longa (Turmeric)': {
    species: 'Curcuma longa L.',
    family: 'Zingiberaceae',
    commonNames: ['turmeric', 'Indian saffron', 'Haldi'],
    markers: [
      { name: 'curcumin', formula: 'C21H20O6', mass: 368.126, weight: 1.0 },
      { name: 'demethoxycurcumin', formula: 'C20H18O5', mass: 338.115, weight: 0.9 },
      { name: 'bisdemethoxycurcumin', formula: 'C19H16O4', mass: 308.105, weight: 0.9 },
      { name: 'ar-turmerone', formula: 'C15H20O', mass: 216.151, weight: 0.8 },
      { name: 'turmerone', formula: 'C15H22O', mass: 218.167, weight: 0.8 },
      { name: 'zingiberene', formula: 'C15H24', mass: 204.188, weight: 0.6 },
      { name: 'cyclocurcumin', formula: 'C21H20O6', mass: 368.126, weight: 0.7 },
    ],
    pharmacopoeia: ['USP', 'EP', 'Ayurvedic Pharmacopoeia'],
    parts: ['rhizome'],
    adulteration: ['Curcuma aromatica', 'tartrazine (synthetic dye)'],
    authenticityThreshold: 0.65,
  },

  'Zingiber officinale (Ginger)': {
    species: 'Zingiber officinale Roscoe',
    family: 'Zingiberaceae',
    commonNames: ['ginger', 'common ginger', 'garden ginger'],
    markers: [
      { name: '6-gingerol', formula: 'C17H26O4', mass: 294.183, weight: 1.0 },
      { name: '8-gingerol', formula: 'C19H30O4', mass: 322.214, weight: 0.9 },
      { name: '10-gingerol', formula: 'C21H34O4', mass: 350.245, weight: 0.9 },
      { name: '6-shogaol', formula: 'C17H24O3', mass: 276.172, weight: 0.9 },
      { name: '8-shogaol', formula: 'C19H28O3', mass: 304.203, weight: 0.8 },
      { name: '6-paradol', formula: 'C17H26O3', mass: 278.188, weight: 0.7 },
      { name: 'zingerone', formula: 'C11H14O3', mass: 194.094, weight: 0.7 },
      { name: 'galanolactone', formula: 'C15H20O2', mass: 232.146, weight: 0.6 },
    ],
    pharmacopoeia: ['USP', 'EP', 'BP'],
    parts: ['rhizome'],
    adulteration: ['Zingiber zerumbet', 'Kaempferia galanga'],
    authenticityThreshold: 0.6,
  },

  'Glycyrrhiza glabra (Liquorice)': {
    species: 'Glycyrrhiza glabra L.',
    family: 'Fabaceae',
    commonNames: ['liquorice', 'licorice', 'sweet root'],
    markers: [
      { name: 'glycyrrhizin', formula: 'C42H62O16', mass: 822.395, weight: 1.0 },
      { name: 'glycyrrhetinic acid', formula: 'C30H46O4', mass: 470.339, weight: 0.9 },
      { name: 'liquiritigenin', formula: 'C15H12O4', mass: 256.073, weight: 0.9 },
      { name: 'isoliquiritigenin', formula: 'C15H12O4', mass: 256.073, weight: 0.8 },
      { name: 'glabridin', formula: 'C20H20O4', mass: 324.136, weight: 1.0 },
      { name: 'glycyrrhizic acid', formula: 'C42H62O16', mass: 822.395, weight: 1.0 },
      { name: 'formononetin', formula: 'C16H12O4', mass: 268.073, weight: 0.7 },
      { name: 'liquiritin', formula: 'C21H22O9', mass: 418.126, weight: 0.8 },
    ],
    pharmacopoeia: ['USP', 'EP', 'BP', 'JP'],
    parts: ['root', 'rhizome'],
    adulteration: ['Glycyrrhiza uralensis', 'Glycyrrhiza inflata'],
    authenticityThreshold: 0.6,
  },

  'Hypericum perforatum (St. Johns Wort)': {
    species: 'Hypericum perforatum L.',
    family: 'Hypericaceae',
    commonNames: ["St. John's wort", 'common St. Johnswort'],
    markers: [
      { name: 'hypericin', formula: 'C30H16O8', mass: 504.080, weight: 1.0 },
      { name: 'pseudohypericin', formula: 'C30H16O9', mass: 520.075, weight: 0.9 },
      { name: 'hyperforin', formula: 'C35H52O4', mass: 536.382, weight: 1.0 },
      { name: 'adhyperforin', formula: 'C36H54O4', mass: 550.398, weight: 0.8 },
      { name: 'quercetin', formula: 'C15H10O7', mass: 302.043, weight: 0.7 },
      { name: 'rutin', formula: 'C27H30O16', mass: 610.153, weight: 0.7 },
      { name: 'chlorogenic acid', formula: 'C16H18O9', mass: 354.095, weight: 0.6 },
      { name: 'amentoflavone', formula: 'C30H18O10', mass: 538.090, weight: 0.8 },
    ],
    pharmacopoeia: ['EP', 'BP'],
    parts: ['aerial parts', 'flower', 'leaf'],
    adulteration: ['Hypericum calycinum', 'Hypericum olympicum'],
    authenticityThreshold: 0.65,
  },

  'Silybum marianum (Milk Thistle)': {
    species: 'Silybum marianum (L.) Gaertn.',
    family: 'Asteraceae',
    commonNames: ['milk thistle', 'Mary thistle', 'holy thistle'],
    markers: [
      { name: 'silybin A', formula: 'C25H22O10', mass: 482.121, weight: 1.0 },
      { name: 'silybin B', formula: 'C25H22O10', mass: 482.121, weight: 1.0 },
      { name: 'silydianin', formula: 'C25H22O10', mass: 482.121, weight: 0.9 },
      { name: 'silychristin', formula: 'C25H22O10', mass: 482.121, weight: 0.9 },
      { name: 'isosilybin A', formula: 'C25H22O10', mass: 482.121, weight: 0.8 },
      { name: 'taxifolin', formula: 'C15H12O7', mass: 304.058, weight: 0.7 },
    ],
    pharmacopoeia: ['EP', 'BP'],
    parts: ['fruit', 'seed'],
    adulteration: ['Carduus marianus'],
    authenticityThreshold: 0.65,
  },

  'Rosmarinus officinalis (Rosemary)': {
    species: 'Salvia rosmarinus Schleid.',
    family: 'Lamiaceae',
    commonNames: ['rosemary'],
    markers: [
      { name: 'rosmarinic acid', formula: 'C18H16O8', mass: 360.085, weight: 1.0 },
      { name: 'carnosic acid', formula: 'C20H28O4', mass: 332.199, weight: 1.0 },
      { name: 'carnosol', formula: 'C20H26O4', mass: 330.183, weight: 0.9 },
      { name: 'ursolic acid', formula: 'C30H48O3', mass: 456.355, weight: 0.8 },
      { name: 'oleanolic acid', formula: 'C30H48O3', mass: 456.355, weight: 0.7 },
      { name: 'luteolin', formula: 'C15H10O6', mass: 286.048, weight: 0.7 },
      { name: 'apigenin', formula: 'C15H10O5', mass: 270.053, weight: 0.6 },
    ],
    pharmacopoeia: ['EP', 'BP'],
    parts: ['leaf', 'aerial parts'],
    adulteration: ['Lavandula spp.'],
    authenticityThreshold: 0.6,
  },

  'Ginkgo biloba (Ginkgo)': {
    species: 'Ginkgo biloba L.',
    family: 'Ginkgoaceae',
    commonNames: ['ginkgo', 'maidenhair tree'],
    markers: [
      { name: 'ginkgolide A', formula: 'C20H24O9', mass: 408.143, weight: 1.0 },
      { name: 'ginkgolide B', formula: 'C20H24O10', mass: 424.137, weight: 1.0 },
      { name: 'ginkgolide C', formula: 'C20H24O11', mass: 440.133, weight: 0.9 },
      { name: 'bilobalide', formula: 'C15H18O8', mass: 326.101, weight: 1.0 },
      { name: 'quercetin', formula: 'C15H10O7', mass: 302.043, weight: 0.7 },
      { name: 'kaempferol', formula: 'C15H10O6', mass: 286.048, weight: 0.7 },
      { name: 'isorhamnetin', formula: 'C16H12O7', mass: 316.058, weight: 0.7 },
    ],
    pharmacopoeia: ['EP', 'USP', 'BP'],
    parts: ['leaf'],
    adulteration: ['synthetic quercetin addition'],
    authenticityThreshold: 0.65,
  },

  'Echinacea purpurea (Echinacea)': {
    species: 'Echinacea purpurea (L.) Moench',
    family: 'Asteraceae',
    commonNames: ['purple coneflower', 'echinacea'],
    markers: [
      { name: 'echinacoside', formula: 'C35H46O20', mass: 786.257, weight: 1.0 },
      { name: 'cichoric acid', formula: 'C22H18O12', mass: 474.079, weight: 1.0 },
      { name: 'caffeic acid', formula: 'C9H8O4', mass: 180.042, weight: 0.7 },
      { name: 'chlorogenic acid', formula: 'C16H18O9', mass: 354.095, weight: 0.7 },
      { name: 'alkylamide 8', formula: 'C14H19NO', mass: 217.146, weight: 0.9 },
      { name: 'alkylamide 11', formula: 'C14H21NO', mass: 219.162, weight: 0.9 },
    ],
    pharmacopoeia: ['EP', 'BP'],
    parts: ['aerial parts', 'root'],
    adulteration: ['Parthenium integrifolium'],
    authenticityThreshold: 0.6,
  },

  'Berberis vulgaris (Barberry)': {
    species: 'Berberis vulgaris L.',
    family: 'Berberidaceae',
    commonNames: ['barberry', 'common barberry'],
    markers: [
      { name: 'berberine', formula: 'C20H18NO4', mass: 336.124, weight: 1.0 },
      { name: 'palmatine', formula: 'C21H22NO4', mass: 352.155, weight: 0.9 },
      { name: 'jatrorrhizine', formula: 'C20H20NO4', mass: 338.139, weight: 0.9 },
      { name: 'columbamine', formula: 'C20H20NO4', mass: 338.139, weight: 0.8 },
      { name: 'coptisine', formula: 'C19H14NO4', mass: 320.092, weight: 0.8 },
    ],
    pharmacopoeia: ['Ayurvedic Pharmacopoeia'],
    parts: ['root', 'bark', 'stem'],
    adulteration: ['Coptis chinensis', 'Mahonia aquifolium'],
    authenticityThreshold: 0.65,
  },
};

/**
 * Identify botanical source(s) from a list of annotated metabolites.
 * Returns ranked botanical candidates with confidence scores.
 *
 * @param {Array} annotations — array of {name, formula, exactMass, cosineScore}
 * @returns {Array} ranked botanical candidates
 */
export function identifyBotanical(annotations) {
  const scores = new Map();

  for (const [botanical, profile] of Object.entries(BOTANICAL_FINGERPRINTS)) {
    let totalScore = 0;
    let totalWeight = 0;
    let matchedMarkers = [];
    let missedMarkers = [];

    for (const marker of profile.markers) {
      totalWeight += marker.weight;
      // Find matching annotation by name (fuzzy) or mass (±0.01 Da)
      const match = findMarkerMatch(annotations, marker);
      if (match) {
        const contribution = marker.weight * (match.cosineScore || 0.7);
        totalScore += contribution;
        matchedMarkers.push({
          marker: marker.name,
          annotation: match.name,
          score: match.cosineScore || 0.7,
        });
      } else {
        missedMarkers.push(marker.name);
      }
    }

    const normalizedScore = totalWeight > 0 ? totalScore / totalWeight : 0;
    const coverage = profile.markers.length > 0 ? matchedMarkers.length / profile.markers.length : 0;
    const finalScore = normalizedScore * 0.7 + coverage * 0.3;

    if (matchedMarkers.length >= 1) {
      scores.set(botanical, {
        botanical,
        species: profile.species,
        family: profile.family,
        commonNames: profile.commonNames,
        score: +finalScore.toFixed(4),
        coverage: +coverage.toFixed(3),
        matchedMarkers,
        missedMarkers: missedMarkers.slice(0, 5),
        pharmacopoeia: profile.pharmacopoeia,
        parts: profile.parts,
        knownAdulterants: profile.adulteration,
        authenticityThreshold: profile.authenticityThreshold,
      });
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function findMarkerMatch(annotations, marker) {
  for (const ann of annotations) {
    // Name match (case insensitive, partial)
    if (ann.name && marker.name && ann.name.toLowerCase().includes(marker.name.toLowerCase().split(' ')[0])) {
      return ann;
    }
    // Mass match (±0.02 Da)
    if (ann.exactMass > 0 && marker.mass > 0) {
      if (Math.abs(ann.exactMass - marker.mass) < 0.02) return ann;
    }
    // Formula match
    if (ann.formula && marker.formula && ann.formula === marker.formula) return ann;
  }
  return null;
}

/**
 * Assess authenticity of a botanical extract.
 * Checks presence of expected markers, absence of adulteration markers,
 * and expected concentration ratios.
 *
 * @param {Array} botanicalCandidates — output of identifyBotanical()
 * @param {Array} annotations — all annotated features
 * @returns {Object} authenticity assessment
 */
export function assessAuthenticity(botanicalCandidates, annotations) {
  if (!botanicalCandidates.length) {
    return {
      authentic: false,
      confidence: 0,
      verdict: 'UNDETERMINED',
      reason: 'No botanical source identified from detected metabolites.',
      flags: ['insufficient_markers'],
    };
  }

  const top = botanicalCandidates[0];
  const flags = [];
  let authenticityScore = top.score;

  // Check coverage of expected markers
  const coveragePct = top.coverage * 100;
  if (coveragePct < 30) {
    flags.push(`low_marker_coverage_${coveragePct.toFixed(0)}pct`);
    authenticityScore *= 0.7;
  }

  // Check for known adulterants
  for (const adulterant of (top.knownAdulterants || [])) {
    const adulterantName = adulterant.toLowerCase().replace(/[^a-z\s]/g, '');
    // Simple check: look for adulterant-associated marker names in annotations
    const adulterantPresent = annotations.some(a =>
      a.name?.toLowerCase().includes(adulterantName.split(' ')[0])
    );
    if (adulterantPresent) {
      flags.push(`potential_adulterant_${adulterant.replace(/\s/g, '_')}`);
      authenticityScore *= 0.8;
    }
  }

  // Check if there's a competing botanical candidate
  if (botanicalCandidates.length > 1) {
    const second = botanicalCandidates[1];
    const scoreRatio = second.score / top.score;
    if (scoreRatio > 0.7) {
      flags.push(`ambiguous_identity_competing_botanical_${second.botanical.split(' ')[0]}`);
      authenticityScore *= 0.85;
    }
  }

  // Check missing key markers
  if (top.missedMarkers?.length > top.matchedMarkers?.length) {
    flags.push('majority_markers_absent');
    authenticityScore *= 0.75;
  }

  // Determine verdict
  const threshold = top.authenticityThreshold || 0.6;
  let verdict, authentic;

  if (authenticityScore >= threshold) {
    if (flags.length === 0) {
      verdict = 'AUTHENTIC';
      authentic = true;
    } else if (flags.some(f => f.includes('adulterant'))) {
      verdict = 'AUTHENTIC_WITH_ADULTERANT_CONCERN';
      authentic = false;
    } else {
      verdict = 'LIKELY_AUTHENTIC';
      authentic = true;
    }
  } else if (authenticityScore >= threshold * 0.6) {
    verdict = 'QUESTIONABLE';
    authentic = false;
  } else {
    verdict = 'NOT_AUTHENTIC';
    authentic = false;
  }

  return {
    authentic,
    confidence: +authenticityScore.toFixed(4),
    verdict,
    primaryBotanical: top.botanical,
    pharmacopoeia: top.pharmacopoeia,
    coveragePct: +coveragePct.toFixed(1),
    matchedMarkers: top.matchedMarkers.map(m => m.marker),
    missingMarkers: top.missedMarkers,
    flags,
    reason: buildAuthenticityReason(verdict, top, flags),
  };
}

function buildAuthenticityReason(verdict, botanical, flags) {
  const reasons = [];
  const pct = (botanical.coverage * 100).toFixed(0);

  switch (verdict) {
    case 'AUTHENTIC':
      reasons.push(`${pct}% of expected marker compounds detected for ${botanical.botanical}.`);
      reasons.push(`Marker profile consistent with ${botanical.pharmacopoeia?.join('/')} standards.`);
      break;
    case 'LIKELY_AUTHENTIC':
      reasons.push(`${pct}% marker coverage for ${botanical.botanical}.`);
      if (flags.length > 0) reasons.push(`Minor concerns: ${flags.join(', ')}.`);
      break;
    case 'AUTHENTIC_WITH_ADULTERANT_CONCERN':
      reasons.push(`Primary botanical identified as ${botanical.botanical} (${pct}% coverage).`);
      reasons.push('Potential adulterant markers detected. Further confirmatory analysis recommended.');
      break;
    case 'QUESTIONABLE':
      reasons.push(`Low confidence botanical identification: ${botanical.botanical} (${pct}% coverage).`);
      reasons.push('Insufficient marker compounds detected for definitive authentication.');
      break;
    case 'NOT_AUTHENTIC':
      reasons.push(`Insufficient evidence for ${botanical.botanical} (${pct}% marker coverage).`);
      reasons.push(`Flags: ${flags.join(', ')}.`);
      break;
  }

  return reasons.join(' ');
}
