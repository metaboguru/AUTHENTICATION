# LC-MS Metabolomics Workflow — Claude Code Configuration

## Project
High-resolution LC-MS/MS metabolomics annotation pipeline for botanical identification and authenticity assessment. Powered by Ruflo (claude-flow@alpha) multi-agent orchestration.

## Architecture
Multi-agent swarm (ruflo hierarchical mesh):
- Queen orchestrator coordinates 5 specialist workers
- Phase 1: Spectral matching (GNPS, MassBank) + Database annotation (PubChem, HMDB, MW) — PARALLEL
- Phase 2: Literature search (PubMed, Europe PMC, CrossRef) — sequential
- Phase 3: Botanical identification + Authenticity assessment — PARALLEL
- Phase 4: Report generation

## Key Files
- `scripts/annotate.js` — Main CLI entry point
- `src/parsers/mzxml-parser.js` — mzXML parser (base64 peak decoding, POS/NEG)
- `src/spectral/spectral-matcher.js` — Cosine similarity + GNPS/MassBank APIs
- `src/databases/pubchem-client.js` — PubChem PUG REST client
- `src/databases/hmdb-client.js` — HMDB, Metabolomics Workbench, ChEBI
- `src/literature/pubmed-client.js` — PubMed E-utilities, Europe PMC, CrossRef
- `src/workflow/botanical-identifier.js` — Botanical fingerprint DB + authenticity scoring
- `src/workflow/orchestrator.js` — Main workflow coordinator
- `src/reports/report-generator.js` — JSON + text report generation
- `src/agents/agent-definitions.js` — Ruflo agent definitions
- `config/swarm.config.yaml` — Swarm topology config

## Usage
```bash
# Install dependencies
npm install

# Annotate a real mzXML file
node scripts/annotate.js --input sample.mzXML --polarity NEG --verbose

# Run demo with synthetic green tea data
node scripts/annotate.js --demo --verbose

# JSON output mode
node scripts/annotate.js --input sample.mzXML --json > report.json
```

## Behavioral Rules
- NEVER save working files to root folder
- Use /src for source, /config for config, /scripts for CLI, /output for results
- Always read files before editing
- Batch parallel tool calls
