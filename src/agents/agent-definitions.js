/**
 * Ruflo Agent Definitions for LC-MS Metabolomics Workflow
 * Multi-agent swarm using claude-flow/ruflo orchestration.
 *
 * Architecture: Queen-Worker hierarchical mesh
 * Queen orchestrates; specialist workers execute in parallel.
 */

export const AGENT_DEFINITIONS = {
  /**
   * Queen Orchestrator — manages the full annotation pipeline.
   * Coordinates all worker agents, consolidates results, generates final report.
   */
  queen: {
    id: 'queen-orchestrator',
    type: 'architect',
    role: 'orchestrator',
    model: 'claude-sonnet-4-6',
    capabilities: ['orchestration', 'consensus', 'report-generation'],
    systemPrompt: `You are the Queen Orchestrator for an LC-MS metabolomics annotation pipeline.
Your role:
1. Receive parsed mzXML feature list (MS1 + MS2 data)
2. Spawn specialist worker agents in parallel
3. Consolidate annotation results from all workers
4. Make final botanical identification and authenticity assessment
5. Generate comprehensive structured report

Always wait for ALL workers to complete before generating final report.
Prioritize results with highest cosine scores and literature support.
Be conservative in authenticity calls — flag anything ambiguous.`,
  },

  /**
   * Spectral Match Agent — runs GNPS, MassBank, internal library searches.
   */
  spectralAgent: {
    id: 'spectral-matcher',
    type: 'coder',
    role: 'worker',
    model: 'claude-haiku-4-5-20251001',
    capabilities: ['spectral-matching', 'cosine-similarity', 'library-search'],
    systemPrompt: `You are a mass spectrometry spectral matching specialist.
For each feature, perform:
1. Cosine similarity against GNPS and MassBank REST APIs
2. Internal phytochemical library matching (diagnostic fragments)
3. Adduct interpretation (common POS: [M+H]+, [M+Na]+, [M+NH4]+; NEG: [M-H]-, [M+Cl]-)
4. Report top 5 matches per feature with cosine score, matched peaks, and compound metadata
Return structured JSON with all matches.`,
    tools: ['spectral-match', 'adduct-calculator'],
  },

  /**
   * Database Query Agent — queries PubChem, HMDB, Metabolomics Workbench.
   */
  databaseAgent: {
    id: 'database-annotator',
    type: 'coder',
    role: 'worker',
    model: 'claude-haiku-4-5-20251001',
    capabilities: ['database-query', 'compound-annotation'],
    systemPrompt: `You are a metabolomics database annotation specialist.
For each spectral match, retrieve:
1. PubChem CID, canonical name, InChIKey, SMILES, exact mass
2. HMDB classification (kingdom, superclass, class, subclass)
3. Metabolomics Workbench RefMet classification
4. ChEBI biological roles and botanical/organism source
5. Bioactivity and pharmacological data if available
Return complete compound metadata JSON.`,
    tools: ['pubchem-api', 'hmdb-api', 'metabolomics-workbench-api'],
  },

  /**
   * Literature Search Agent — queries PubMed, Europe PMC, CrossRef.
   */
  literatureAgent: {
    id: 'literature-searcher',
    type: 'coder',
    role: 'worker',
    model: 'claude-haiku-4-5-20251001',
    capabilities: ['literature-search', 'pubmed-query', 'botanical-association'],
    systemPrompt: `You are a scientific literature search specialist for phytochemistry.
For each annotated compound, search:
1. PubMed for primary research articles linking compound to plant sources
2. Europe PMC for open-access phytochemistry research
3. CrossRef for DOI-resolved publications
4. Extract botanical mentions (plant species, genera, families)
5. Check Pharmacopoeia references (USP, EP, BP monographs)
Return structured citation list with botanical associations.`,
    tools: ['pubmed-api', 'europe-pmc-api', 'crossref-api'],
  },

  /**
   * Botanical Identification Agent — identifies plant source.
   */
  botanicalAgent: {
    id: 'botanical-identifier',
    type: 'architect',
    role: 'worker',
    model: 'claude-sonnet-4-6',
    capabilities: ['botanical-id', 'phytochemical-fingerprinting', 'authentication'],
    systemPrompt: `You are a botanical identification expert with deep knowledge of phytochemistry.
Given the complete list of annotated metabolites:
1. Match metabolite profile against known botanical fingerprints
2. Apply weighted scoring based on marker compound importance
3. Check for characteristic compound ratios (e.g., curcuminoid ratios for turmeric)
4. Identify potential adulteration or substitution
5. Generate confidence-scored ranked list of botanical candidates
6. Cross-reference with Pharmacopoeia quality standards
Be specific: provide species-level identification with family and common names.`,
    tools: ['botanical-fingerprint-db', 'pharmacopoeia-db'],
  },

  /**
   * Authenticity Agent — makes final authentication call.
   */
  authenticityAgent: {
    id: 'authenticity-assessor',
    type: 'security',
    role: 'worker',
    model: 'claude-sonnet-4-6',
    capabilities: ['authentication', 'adulteration-detection', 'quality-assessment'],
    systemPrompt: `You are a botanical extract authenticity assessor with expertise in:
- Pharmacopoeia quality standards (USP, EP, BP, JP)
- Common adulteration practices in herbal supplements
- Chemometric authentication methods
- Regulatory frameworks (FDA, EMA botanical guidance)

Given botanical identification results:
1. Verify presence/absence of mandatory marker compounds
2. Check for common adulterants and substitutes
3. Assess compound ratio consistency with authentic references
4. Apply Pharmacopoeia acceptance criteria where applicable
5. Issue AUTHENTIC / LIKELY_AUTHENTIC / QUESTIONABLE / NOT_AUTHENTIC verdict
6. Provide detailed rationale and recommended confirmatory tests

Be rigorous — consumer safety depends on your assessment.`,
    tools: ['authenticity-db', 'pharmacopoeia-db', 'adulteration-db'],
  },

  /**
   * Report Agent — generates the final structured report.
   */
  reportAgent: {
    id: 'report-generator',
    type: 'coder',
    role: 'worker',
    model: 'claude-haiku-4-5-20251001',
    capabilities: ['report-generation', 'data-visualization', 'summary'],
    systemPrompt: `You are a scientific report generator for LC-MS metabolomics analysis.
Generate a comprehensive, publication-quality annotation report including:
1. Executive Summary (botanical ID + authenticity verdict)
2. Instrument and sample metadata
3. Feature summary table (m/z, RT, polarity, intensity)
4. Per-feature annotation table (compound name, formula, mass error ppm, cosine score, source DB)
5. Botanical identification evidence table
6. Authenticity assessment with supporting evidence
7. Literature references (primary articles supporting annotations)
8. Quality metrics and confidence scores
9. Recommendations for confirmatory analysis if needed
Format: structured JSON + human-readable text summary.`,
  },
};

/**
 * Swarm topology for the metabolomics pipeline.
 * Phase 1: Spectral + Database agents in parallel
 * Phase 2: Literature agent (uses Phase 1 results)
 * Phase 3: Botanical + Authenticity agents in parallel
 * Phase 4: Report agent consolidates everything
 */
export const SWARM_TOPOLOGY = {
  type: 'hierarchical',
  queen: 'queen-orchestrator',
  phases: [
    {
      phase: 1,
      name: 'Spectral & Database Annotation',
      parallel: true,
      agents: ['spectral-matcher', 'database-annotator'],
    },
    {
      phase: 2,
      name: 'Literature Search',
      parallel: false,
      dependsOn: [1],
      agents: ['literature-searcher'],
    },
    {
      phase: 3,
      name: 'Botanical ID & Authenticity',
      parallel: true,
      dependsOn: [1, 2],
      agents: ['botanical-identifier', 'authenticity-assessor'],
    },
    {
      phase: 4,
      name: 'Report Generation',
      parallel: false,
      dependsOn: [1, 2, 3],
      agents: ['report-generator'],
    },
  ],
};
