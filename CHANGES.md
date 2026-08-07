# FreDa — Push Changes & Full Commit History
**Repository:** https://github.com/eswar-m4/fredaa  
**Branch:** master  
**Date:** August 7, 2026  

---

## Full Commit History

| Commit | Date | Message |
|--------|------|---------|
| `66e847c` | 2026-08-07 | Update FreDa with latest changes *(latest push)* |
| `9379ac0` | 2026-07-30 | Push full workspace snapshot |
| `83179c8` | 2026-07-30 | Update repo structure and app changes |
| `d04db8c` | 2026-07-01 | Clean up stuck Running jobs on startup and on new job launches |
| `dfd2281` | 2026-07-01 | Fix monitoring job list sorting tie-breaker to keep latest run of a source visible |
| `b53dc74` | 2026-07-01 | Fix binding mismatch in jobs launch endpoint |
| `7c1b52f` | 2026-07-01 | Register partial scrape adapters for investegate and turkeybrokers |
| `2919f3d` | 2026-06-30 | Enforce strict constraint on mapping suggestions target fields |
| `7bd4ff0` | 2026-06-30 | Add AI mapping loading state and improve prompt accuracy with synonyms |
| `52c735c` | 2026-06-30 | Fix dataset job launching race condition and deduplication in monitoring |
| `e337c32` | 2026-06-30 | Improve AI field mapping prompts and confidence scoring extraction |
| `6844500` | 2026-06-30 | Add header select-all/deselect-all checkbox next to system attribute in any-site.tsx |
| `9098881` | 2026-06-30 | Display quality metrics for completed jobs in review page |
| `ec3490a` | 2026-06-30 | Exclude custom onboarding sources from the review tables |
| `1c4896f` | 2026-06-30 | Fix kind variable reference to j.kind in review.tsx |
| `575439b` | 2026-06-30 | Update review status labels, scope naming, and one-time schedule checks |
| `35bedcf` | 2026-06-30 | Update backend review data scraper lookup records limit |
| `3c0d6a6` | 2026-06-30 | Paginate review table by recordIndex and recordsPerPage |
| `4fe17f9` | 2026-06-30 | Show dash for records count on custom onboarding sources |
| `a2e459b` | 2026-06-30 | Add pending onboarding KPI card in monitoring dashboard |
| `3f3d9b3` | 2026-06-30 | Ensure custom sources keep name and status as pending onboarding on monitoring page |
| `9958045` | 2026-06-30 | Add z-10 class to sticky table headers in review queue |
| `b11be56` | 2026-06-30 | Update recurring frequencies and pagination page size in review queue |
| `7dfb34c` | 2026-06-30 | Update monitoring page badges to say By Source and By Dataset |
| `110b2cf` | 2026-06-30 | Adjust step 2 pattern criteria and frequency styling and add export delivery option |
| `519452a` | 2026-06-30 | Update frequency widget to use click-based flyout menu toggling |
| `6cd44a7` | 2026-06-30 | Completed review queue, scheduling, scope, estimates, and pagination enhancements |
| `ff0f81d` | 2026-06-30 | Checkpoint before implementation plan |
| `80f5f40` | 2026-06-15 | Move search bar and Add Source button to PageHeader actions. Implement Advanced Search popover for Category, Country, and Complexity filters. Remove old search card container. |
| `30cd780` | 2026-06-15 | Bring back original Running flow for backend scraper runs and handle Pending Onboarding mapping on frontend. Remove static JobsPanel from step 0 of site-specific wizard. |
| `a7d350d` | 2026-06-12 | Set initial custom source scraper status to 'Pending Onboarding' |
| `6b77a80` | 2026-06-12 | Remove confidence report feature and clean up associated code |
| `233a214` | 2026-06-11 | Initialize project structure with backend and frontend folders |

---

## What Changed in the Latest Push (`66e847c`)

### Backend — New File
- **`backend/app/services/firmographic_profile_service.py`** *(334 lines)*  
  New service for building firmographic profiles of companies.

### Backend — Modified Services
- **`workflow_service.py`** — ~284 lines changed. Core workflow orchestration improvements.
- **`openai_cde_service.py`** — ~196 lines changed. Improved OpenAI-based CDE enrichment logic.
- **`company_verification_service.py`** — ~202 lines changed. Enhanced company verification flow.
- **`website_scraper.py`** — ~474 lines changed. Scraping improvements.
- **`enrichment_service.py`** — ~29 lines changed.
- **`batch_workflow_service.py`** — Minor update (1 line).

### Backend — Registry Scrapers (all updated)
- `registry_orchestrator.py` — ~90 lines changed
- `sec_scraper.py` — ~97 lines changed
- `mca_scraper.py` — ~61 lines changed
- `companies_house_scraper.py` — ~42 lines changed

### Backend — API Routes
- **`demo_routes.py`** — ~39 lines changed. Updates to demo API endpoints.

### Backend — Bot Packages
- **`nationalgrid_tso29_gasflow_sso_nomrenom_prod_dem/run.py`** — New run script added (~32 lines).

### Backend — Tests
- **`backend/tests/test_openai_cde_service.py`** — New test file (~54 lines).

### Frontend — New Files
- **`frontend/src/data/category-art.ts`** *(137 lines)* — New category art/icon data.
- **`frontend/src/data/vertical-datasets.ts`** *(387 lines)* — New vertical datasets definitions.

### Frontend — Modified Files
- **`frontend/src/routes/index.tsx`** — ~252 lines changed. Major updates to the main home route UI.
- **`frontend/src/routes/any-site.tsx`** — ~55 lines changed. Updates to the any-site scraping UI.
- **`frontend/src/components/AppLayout.tsx`** — ~11 lines changed. Minor layout adjustments.
- **`frontend/src/data/datasets.ts`** — ~11 lines added. New dataset entries.
- **`frontend/src/lib/useCase.ts`** — ~11 lines changed. Use case logic updates.

### Datasets
- New job run and comparison JSON files added for multiple jobs.
- New review cache entries added under `backend/datasets/.review_cache/`.

---

## What's NOT in the Repo (by design)

| Item | Why excluded |
|---|---|
| `.env` | Contains secret API keys — must be created from `.env.example` |
| `.venv/` | Python virtual environment — recreate with `pip install -r requirements.txt` |
| `.pytest_cache/` | Auto-generated test cache |
| `.agents/` / `.codex/` | Local AI tooling config |
| `backend/logs/` | Runtime logs |

---

## Setup Instructions for Hosting

1. **Clone the repo**
   ```bash
   git clone https://github.com/eswar-m4/fredaa.git
   cd fredaa
   ```

2. **Backend setup**
   ```bash
   cd backend
   python -m venv .venv
   .venv\Scripts\activate        # Windows
   # source .venv/bin/activate   # Mac/Linux
   pip install -r requirements.txt
   cp .env.example .env
   # Edit .env and fill in your API keys
   uvicorn app.main:app --reload
   ```

3. **Frontend setup**
   ```bash
   cd frontend
   npm install
   npm run build     # for production
   # or
   npm run dev       # for development
   ```

4. **Required API keys** (fill into `.env`)
   - `OPENAI_API_KEY`
   - `GEMINI_API_KEY`
   - `GROQ_API_KEY`
   - `LOVABLE_API_KEY`
