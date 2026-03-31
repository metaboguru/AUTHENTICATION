/**
 * PubChem PUG REST API client.
 * Docs: https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest
 */

import fetch from 'node-fetch';

const BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';
const VIEW_BASE = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug_view';

async function fetchWithTimeout(url, ms = 12000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { signal: c.signal });
    return r;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Search PubChem by formula, InChIKey, or name.
 * Returns compound metadata including synonyms, classifications, bioactivities.
 */
export async function searchPubChem(query, type = 'name') {
  try {
    let url;
    if (type === 'formula') {
      url = `${BASE}/compound/formula/${encodeURIComponent(query)}/JSON?MaxRecords=5`;
    } else if (type === 'inchikey') {
      url = `${BASE}/compound/inchikey/${encodeURIComponent(query)}/JSON`;
    } else {
      url = `${BASE}/compound/name/${encodeURIComponent(query)}/JSON?MaxRecords=5`;
    }

    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const compounds = data.PC_Compounds || [];
    if (!compounds.length) return null;

    return compounds.map(parsePubChemCompound).filter(Boolean);
  } catch (err) {
    return null;
  }
}

/**
 * Get detailed PubChem compound info by CID including taxonomy and botanical info.
 */
export async function getPubChemCID(cid) {
  try {
    const [propResp, synResp, classResp] = await Promise.all([
      fetchWithTimeout(`${BASE}/compound/cid/${cid}/property/MolecularFormula,MolecularWeight,IUPACName,InChIKey,IsomericSMILES,ExactMass/JSON`),
      fetchWithTimeout(`${BASE}/compound/cid/${cid}/synonyms/JSON`),
      fetchWithTimeout(`${VIEW_BASE}/data/compound/${cid}/JSON?heading=Taxonomy`),
    ]);

    const propData = propResp.ok ? await propResp.json() : {};
    const synData = synResp.ok ? await synResp.json() : {};
    const classData = classResp.ok ? await classResp.json() : {};

    const props = propData.PropertyTable?.Properties?.[0] || {};
    const synonyms = synData.InformationList?.Information?.[0]?.Synonym || [];

    // Extract taxonomy/botanical info
    const taxoInfo = extractTaxonomyFromPubChemView(classData);

    return {
      cid,
      formula: props.MolecularFormula || '',
      molecularWeight: props.MolecularWeight || 0,
      iupacName: props.IUPACName || '',
      inchiKey: props.InChIKey || '',
      smiles: props.IsomericSMILES || '',
      exactMass: props.ExactMass || 0,
      synonyms: synonyms.slice(0, 20),
      taxonomy: taxoInfo,
      pubchemUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    };
  } catch (err) {
    return null;
  }
}

function parsePubChemCompound(c) {
  if (!c?.id?.id?.cid) return null;
  const cid = c.id.id.cid;

  // Parse props array
  const props = {};
  for (const p of c.props || []) {
    const urn = p.urn?.label || '';
    const val = p.value?.sval || p.value?.fval || p.value?.ival || '';
    if (urn && val !== undefined) props[urn] = val;
  }

  return {
    cid,
    formula: props['Molecular Formula'] || '',
    iupacName: props['IUPAC Name'] || props['Preferred'] || '',
    inchiKey: props['InChIKey'] || '',
    smiles: props['SMILES'] || props['Isomeric'] || '',
    exactMass: parseFloat(props['Exact'] || props['Mass'] || 0),
    pubchemUrl: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
  };
}

function extractTaxonomyFromPubChemView(data) {
  const result = { organisms: [], plantSources: [] };
  try {
    const sections = data?.Record?.Section || [];
    for (const sec of sections) {
      if (sec.TOCHeading?.includes('Taxonomy') || sec.TOCHeading?.includes('Biological')) {
        const info = sec.Information || [];
        for (const inf of info) {
          const val = inf.Value?.StringWithMarkup?.[0]?.String || '';
          if (val) result.organisms.push(val);
        }
      }
    }
  } catch {}
  return result;
}

/**
 * Get bioassay/biological activity data for a CID.
 */
export async function getBioactivity(cid) {
  try {
    const resp = await fetchWithTimeout(
      `${BASE}/compound/cid/${cid}/assaysummary/JSON?limit=20`
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.Table?.Row?.slice(0, 10).map(r => {
      const cells = r.Cell || [];
      return {
        aid: cells[0],
        activity: cells[3],
        target: cells[6],
        activityValue: cells[7],
      };
    }) || [];
  } catch {
    return [];
  }
}

/**
 * Search PubChem for compounds found in specific plant/botanical context.
 */
export async function searchBotanicalContext(compoundName, plantName) {
  try {
    const query = `${compoundName} ${plantName}`;
    const url = `${BASE}/compound/name/${encodeURIComponent(compoundName)}/cids/JSON`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    const data = await resp.json();
    const cid = data.IdentifierList?.CID?.[0];
    if (!cid) return null;

    return getPubChemCID(cid);
  } catch {
    return null;
  }
}
