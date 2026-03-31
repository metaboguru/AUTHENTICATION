/**
 * Literature Search Engine
 * Queries PubMed (NCBI E-utilities), Europe PMC, and CrossRef
 * for peer-reviewed publications linking metabolites to botanical sources.
 *
 * APIs:
 *  - NCBI E-utilities: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 *  - Europe PMC REST: https://europepmc.org/RestfulWebService
 *  - CrossRef: https://api.crossref.org/works
 */

import fetch from 'node-fetch';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const EPMC = 'https://www.ebi.ac.uk/europepmc/webservices/rest';
const CROSSREF = 'https://api.crossref.org';

const TOOL = 'lcms-metabolomics-workflow';
const EMAIL = 'research@metabolomics.local';

async function get(url, timeout = 15000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), timeout);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: { 'Accept': 'application/json' },
    });
    return r;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Search PubMed for articles linking a compound to a botanical source.
 */
export async function searchPubMed(compoundName, botanicalContext = '') {
  try {
    const query = botanicalContext
      ? `"${compoundName}"[Title/Abstract] AND ("plant"[MeSH Terms] OR "${botanicalContext}"[Title/Abstract]) AND (phytochemical OR metabolite OR extract)`
      : `"${compoundName}"[Title/Abstract] AND (plant OR phytochemical OR botanical OR herb OR extract OR metabolite)`;

    // Step 1: ESearch
    const searchUrl = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=20&retmode=json&tool=${TOOL}&email=${EMAIL}&sort=relevance`;
    const searchResp = await get(searchUrl);
    if (!searchResp.ok) return [];

    const searchData = await searchResp.json();
    const ids = searchData.esearchresult?.idlist || [];
    if (!ids.length) return [];

    // Step 2: ESummary for metadata
    const summaryUrl = `${EUTILS}/esummary.fcgi?db=pubmed&id=${ids.slice(0, 15).join(',')}&retmode=json&tool=${TOOL}&email=${EMAIL}`;
    const summaryResp = await get(summaryUrl);
    if (!summaryResp.ok) return [];

    const summaryData = await summaryResp.json();
    const result = summaryData.result || {};

    return ids.slice(0, 10).map(id => {
      const art = result[id];
      if (!art) return null;
      return {
        pmid: id,
        title: art.title || '',
        authors: (art.authors || []).slice(0, 3).map(a => a.name).join(', '),
        journal: art.source || '',
        year: art.pubdate?.split(' ')[0] || '',
        doi: art.elocationid?.replace('doi: ', '') || '',
        botanicalMention: extractBotanicalMentions(art.title + ' ' + (art.sortpubdate || '')),
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
      };
    }).filter(Boolean);
  } catch (err) {
    return [];
  }
}

/**
 * Search Europe PMC for open-access articles.
 */
export async function searchEuropePMC(compoundName, botanicalContext = '') {
  try {
    const query = botanicalContext
      ? `"${compoundName}" AND ("${botanicalContext}" OR plant OR botanical OR phytochemical) AND (OPEN_ACCESS:Y)`
      : `"${compoundName}" AND (plant OR phytochemical OR botanical OR herb OR metabolomics)`;

    const url = `${EPMC}/search?query=${encodeURIComponent(query)}&resulttype=core&pageSize=10&format=json&sort=RELEVANCE`;
    const resp = await get(url);
    if (!resp.ok) return [];

    const data = await resp.json();
    const results = data.resultList?.result || [];

    return results.map(r => ({
      source: 'EuropePMC',
      pmid: r.pmid || '',
      pmcid: r.pmcid || '',
      title: r.title || '',
      authors: (r.authorList?.author || []).slice(0, 3).map(a => `${a.firstName || ''} ${a.lastName || ''}`).join(', '),
      journal: r.journalTitle || r.bookOrReportDetails?.publisher || '',
      year: r.pubYear || '',
      doi: r.doi || '',
      abstractText: (r.abstractText || '').slice(0, 300),
      openAccess: r.isOpenAccess === 'Y',
      botanicalMention: extractBotanicalMentions(r.title + ' ' + (r.abstractText || '')),
      url: r.doi ? `https://doi.org/${r.doi}` : (r.pmid ? `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` : ''),
    }));
  } catch (err) {
    return [];
  }
}

/**
 * Search CrossRef for DOI-resolved articles on metabolite-botanical associations.
 */
export async function searchCrossRef(compoundName, botanicalContext = '') {
  try {
    const query = botanicalContext
      ? `${compoundName} ${botanicalContext} phytochemical`
      : `${compoundName} plant metabolite annotation`;

    const url = `${CROSSREF}/works?query=${encodeURIComponent(query)}&rows=8&select=DOI,title,author,published,container-title,abstract&filter=type:journal-article`;
    const resp = await get(url);
    if (!resp.ok) return [];

    const data = await resp.json();
    const items = data.message?.items || [];

    return items.map(item => ({
      source: 'CrossRef',
      doi: item.DOI || '',
      title: Array.isArray(item.title) ? item.title[0] : (item.title || ''),
      authors: (item.author || []).slice(0, 3).map(a => `${a.given || ''} ${a.family || ''}`).join(', '),
      journal: Array.isArray(item['container-title']) ? item['container-title'][0] : (item['container-title'] || ''),
      year: item.published?.['date-parts']?.[0]?.[0] || '',
      abstract: (item.abstract || '').replace(/<[^>]+>/g, '').slice(0, 200),
      url: `https://doi.org/${item.DOI || ''}`,
    })).filter(r => r.title);
  } catch {
    return [];
  }
}

/**
 * Extract botanical/plant name mentions from text.
 */
function extractBotanicalMentions(text) {
  if (!text) return [];
  const patterns = [
    /\b([A-Z][a-z]+ [a-z]+(?:\s[a-z]+)?)\s+(?:L\.|Linn\.|Willd\.|DC\.|Thunb\.|Mill\.)/g,
    /\b(Zingiber|Curcuma|Panax|Camellia|Glycyrrhiza|Hypericum|Echinacea|Valerian|Ginkgo|Aloe|Salvia|Rosmarinus|Lavandula|Melissa|Silybum|Berberis|Piper|Capsicum|Tanacetum|Matricaria)\s+\w+/gi,
    /\b(ginger|turmeric|ginseng|green tea|licorice|St\. John's wort|echinacea|valerian|ginkgo|aloe vera|sage|rosemary|lavender|milk thistle|berberine|black pepper|chamomile)\b/gi,
  ];

  const found = new Set();
  for (const pat of patterns) {
    let m;
    while ((m = pat.exec(text)) !== null) {
      found.add(m[0].trim());
    }
  }
  return [...found];
}

/**
 * Full literature search combining all sources.
 */
export async function fullLiteratureSearch(compoundName, botanicalContext = '', inchiKey = '') {
  const [pubmedResults, epmcResults, crossrefResults] = await Promise.all([
    searchPubMed(compoundName, botanicalContext),
    searchEuropePMC(compoundName, botanicalContext),
    searchCrossRef(compoundName, botanicalContext),
  ]);

  // Merge and deduplicate by DOI or title
  const allResults = [...pubmedResults, ...epmcResults, ...crossrefResults];
  const seen = new Map();
  for (const r of allResults) {
    const key = r.doi || r.title?.toLowerCase().slice(0, 50);
    if (key && !seen.has(key)) seen.set(key, r);
  }

  const merged = Array.from(seen.values());

  // Extract all botanical mentions
  const allBotanicals = new Set();
  for (const r of merged) {
    for (const b of (r.botanicalMention || [])) {
      allBotanicals.add(b);
    }
  }

  return {
    articles: merged.slice(0, 20),
    botanicalMentions: [...allBotanicals],
    totalFound: merged.length,
  };
}

/**
 * Search for Pharmacopoeia-grade information on a compound.
 * Checks USP, EP (European Pharmacopoeia), BP (British Pharmacopoeia) standard markers.
 */
export async function searchPharmacopoeiaInfo(compoundName) {
  try {
    // PubMed search with pharmacopoeia context
    const query = `"${compoundName}"[Title/Abstract] AND (pharmacopeia OR pharmacopoeia OR "USP" OR "European Pharmacopoeia" OR "British Pharmacopoeia" OR monograph OR standard OR reference material)`;
    const url = `${EUTILS}/esearch.fcgi?db=pubmed&term=${encodeURIComponent(query)}&retmax=10&retmode=json&tool=${TOOL}&email=${EMAIL}`;
    const resp = await get(url);
    if (!resp.ok) return { found: false, articles: [] };

    const data = await resp.json();
    const ids = data.esearchresult?.idlist || [];

    // Known pharmacopoeia marker compounds
    const pharmacopoeiaMarkers = {
      'ginsenoside': { standard: 'USP/EP', plant: 'Panax ginseng', monograph: 'Ginseng' },
      'curcumin': { standard: 'USP', plant: 'Curcuma longa', monograph: 'Turmeric' },
      'hypericin': { standard: 'EP', plant: 'Hypericum perforatum', monograph: "St. John's Wort" },
      'quercetin': { standard: 'USP/EP', plant: 'Various', monograph: 'Multiple' },
      'berberine': { standard: 'USP', plant: 'Berberis spp.', monograph: 'Berberis' },
      'silymarin': { standard: 'EP', plant: 'Silybum marianum', monograph: 'Milk Thistle' },
      'valerenic': { standard: 'EP', plant: 'Valeriana officinalis', monograph: 'Valerian' },
      'rosmarinic': { standard: 'EP', plant: 'Rosmarinus officinalis', monograph: 'Rosemary' },
      'caffeine': { standard: 'USP/EP/BP', plant: 'Camellia sinensis', monograph: 'Caffeine' },
      'chlorogenic': { standard: 'EP', plant: 'Various', monograph: 'Multiple' },
      'glycyrrhizin': { standard: 'USP/EP', plant: 'Glycyrrhiza glabra', monograph: 'Liquorice' },
    };

    const lowerName = compoundName.toLowerCase();
    let pharmacopoeiaMatch = null;
    for (const [key, info] of Object.entries(pharmacopoeiaMarkers)) {
      if (lowerName.includes(key)) {
        pharmacopoeiaMatch = info;
        break;
      }
    }

    return {
      found: ids.length > 0 || !!pharmacopoeiaMatch,
      articleCount: ids.length,
      pharmacopoeiaInfo: pharmacopoeiaMatch,
      pubmedIds: ids.slice(0, 5),
    };
  } catch {
    return { found: false, articles: [] };
  }
}
