/**
 * HMDB (Human Metabolome Database) REST API client.
 * Docs: https://hmdb.ca/api
 * Also queries Metabolomics Workbench and ChEBI.
 */

import fetch from 'node-fetch';

const HMDB_BASE = 'https://hmdb.ca/api/v1';
const MW_BASE = 'https://www.metabolomicsworkbench.org/rest';
const CHEBI_BASE = 'https://www.ebi.ac.uk/webservices/chebi/2.0/test';

async function get(url, timeout = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: { 'Accept': 'application/json, application/xml, */*' },
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Search HMDB by compound name or mass.
 */
export async function searchHMDB(query, type = 'name') {
  try {
    let url;
    if (type === 'mass') {
      // HMDB mass search (±0.01 Da)
      const mass = parseFloat(query);
      url = `${HMDB_BASE}/metabolites/search?query=${mass.toFixed(4)}&type=exact_mass&tolerance=0.01`;
    } else {
      url = `${HMDB_BASE}/metabolites/search?query=${encodeURIComponent(query)}&type=name`;
    }

    const resp = await get(url);
    if (!resp.ok) return [];

    // HMDB returns XML or JSON depending on header
    const text = await resp.text();
    return parseHMDBResponse(text);
  } catch (err) {
    return [];
  }
}

function parseHMDBResponse(text) {
  try {
    const data = JSON.parse(text);
    const metabolites = data.metabolites || (Array.isArray(data) ? data : [data]);
    return metabolites.slice(0, 10).map(m => ({
      hmdbId: m.accession || m.hmdb_id || '',
      name: m.name || m.common_name || '',
      formula: m.chemical_formula || '',
      exactMass: parseFloat(m.monisotopic_molecular_weight || m.average_molecular_weight || 0),
      inchiKey: m.inchikey || '',
      smiles: m.smiles || '',
      kingdom: m.kingdom || '',
      superClass: m.super_class || '',
      classEl: m.class || '',
      subClass: m.sub_class || '',
      biospecimenLocations: m.biospecimen_locations || [],
      tissueLocations: m.tissue_locations || [],
      plantSources: extractHMDBPlantSources(m),
      pathways: (m.pathways || []).slice(0, 5).map(p => p.name || p),
      hmdbUrl: `https://hmdb.ca/metabolites/${m.accession || m.hmdb_id || ''}`,
    }));
  } catch {
    // Try basic XML parsing
    const matches = text.match(/<accession>(HMDB\d+)<\/accession>/g) || [];
    return matches.slice(0, 5).map(m => ({
      hmdbId: m.replace(/<\/?accession>/g, ''),
      name: '',
      formula: '',
      exactMass: 0,
    }));
  }
}

function extractHMDBPlantSources(m) {
  const sources = [];
  const desc = (m.description || '') + ' ' + (m.synthesis_reference || '');
  const plantPatterns = [
    /found in ([A-Z][a-z]+ [a-z]+)/g,
    /isolated from ([A-Z][a-z]+ [a-z]+)/g,
    /([A-Z][a-z]+ [a-z]+) \([\w\s]+\)/g,
  ];
  for (const pat of plantPatterns) {
    let match;
    while ((match = pat.exec(desc)) !== null) {
      sources.push(match[1]);
    }
  }
  return [...new Set(sources)];
}

/**
 * Query Metabolomics Workbench REST API.
 * https://www.metabolomicsworkbench.org/tools/MWRestAPIv1.0.pdf
 */
export async function searchMetabolomicsWorkbench(query, type = 'name') {
  try {
    let url;
    if (type === 'exactmass') {
      url = `${MW_BASE}/compound/regno/mass/${parseFloat(query).toFixed(4)}/0.01/all/`;
    } else if (type === 'inchikey') {
      url = `${MW_BASE}/compound/regno/inchikey/${encodeURIComponent(query)}/all/`;
    } else {
      url = `${MW_BASE}/compound/regno/name/${encodeURIComponent(query)}/all/`;
    }

    url += 'json/';
    const resp = await get(url);
    if (!resp.ok) return [];

    const data = await resp.json();
    const entries = Object.values(data || {}).filter(v => typeof v === 'object');

    return entries.slice(0, 8).map(e => ({
      mwId: e.regno || e.id || '',
      name: e.name || e.pubchem_name || '',
      formula: e.formula || '',
      exactMass: parseFloat(e.exactmass || e.monoisotopic_mass || 0),
      inchiKey: e.inchi_key || '',
      smiles: e.smiles || '',
      pubchemCid: e.pubchem_cid || '',
      keggId: e.kegg_id || '',
      refmetName: e.refmet_name || '',
      classificationSuperClass: e.classification_super_class || '',
      classificationClass: e.classification_class || '',
      classificationSubClass: e.classification_sub_class || '',
      mwUrl: `https://www.metabolomicsworkbench.org/databases/metabolitedatabase.php?regno=${e.regno || ''}`,
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Get study context from Metabolomics Workbench (plant studies).
 */
export async function getMWPlantStudies(compoundName) {
  try {
    const url = `${MW_BASE}/study/study_id/named_by_id/${encodeURIComponent(compoundName)}/json/`;
    const resp = await get(url);
    if (!resp.ok) return [];
    const data = await resp.json();
    return Object.values(data || {}).filter(s => typeof s === 'object').slice(0, 5).map(s => ({
      studyId: s.study_id || '',
      title: s.study_title || '',
      subject: s.subject_species || '',
      institute: s.institute || '',
    }));
  } catch {
    return [];
  }
}

/**
 * Query ChEBI for compound classification and botanical roles.
 */
export async function searchChEBI(name) {
  try {
    const url = `https://www.ebi.ac.uk/chebi/ws/rest/search?search=${encodeURIComponent(name)}&searchFields=ALL_NAMES&maximumResults=5`;
    const resp = await get(url);
    if (!resp.ok) return [];
    const text = await resp.text();

    // Parse minimal XML response
    const results = [];
    const entryMatches = text.match(/<listElement>([\s\S]*?)<\/listElement>/g) || [];
    for (const entry of entryMatches.slice(0, 5)) {
      const id = (entry.match(/<chebiId>(CHEBI:\d+)<\/chebiId>/) || [])[1] || '';
      const chebiName = (entry.match(/<chebiName>(.*?)<\/chebiName>/) || [])[1] || '';
      const stars = parseInt((entry.match(/<entityStar>(\d+)<\/entityStar>/) || [])[1] || 0);
      results.push({ chebiId: id, name: chebiName, stars });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Comprehensive database lookup: HMDB + MW + ChEBI in parallel.
 */
export async function comprehensiveDatabaseLookup(compoundName, formula, exactMass, inchiKey) {
  const [hmdbResults, mwResults, chebiResults] = await Promise.all([
    inchiKey ? searchHMDB(inchiKey, 'name') : searchHMDB(compoundName, 'name'),
    exactMass > 0 ? searchMetabolomicsWorkbench(exactMass.toFixed(4), 'exactmass') : searchMetabolomicsWorkbench(compoundName, 'name'),
    searchChEBI(compoundName),
  ]);

  return {
    hmdb: hmdbResults,
    metabolomicsWorkbench: mwResults,
    chebi: chebiResults,
  };
}
