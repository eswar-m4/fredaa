# Upload Migration Plan (Phase 1)

## Scope
Trace-only dependency report for **Step 1: Upload** to migrate from hybrid path to direct API usage.

- Target path: `New UI Upload -> POST /api/v1/process -> New UI state`
- No backend changes
- No API contract changes
- No code implementation in this step

## Branch Creation Status
Attempted branch creation in current workspace (`c:\Users\tanis\OneDrive\Documents\freda-backend`) is blocked because this directory is not a git repository (`.git` missing).

## Current Upload Render + Execution Dependency (Step 1)

### 1. React component (Upload screen)
- File: `frontend/index.html`
- Component: `jf`
- Mounted by root app component `Pf` when `screen === "upload-wizard"`
- Reference location: minified bundle in `frontend/index.html:11` (single-line bundle)

### 2. Step 1 state variables currently inside `jf`
From component initializer in `jf`:
- `n` (`useState("upload")`) - current wizard step
- `o` (`useState([])`) - completed step list
- `s` (`useState("")`) - selected file name shown on upload card
- `u` (`useState(false)`) - drag/drop hover state
- `q` (`useRef("")`) - dataset/column sync signature ref

Other wizard states exist in same component (`y`, `v`, `k`, `N`, `p`, `g`) but are for later steps; Upload itself depends on `n,o,s,u`.

### 3. Current upload trigger path in hybrid architecture
Current actual runtime chain for file input/drop:

1. User selects file in `jf` Upload UI (file input / drop target)
2. Adapter binder in `frontend/index.html` attaches `change` handler to `input[type=file]`
3. Adapter calls `window.handleFileSelection([file])`
4. `frontend/integration.js` executes upload pipeline:
   - `handleFileSelection(files)`
   - `uploadFiles(files)` (async version)
   - `processSingleUploadFile(file, index, total)`
5. API call to backend:
   - `POST ${FREDA.API_BASE}/process` (i.e. `/api/v1/process`)
6. Response is passed to:
   - `handleProcessResult(result)`
   - dataset creation/selection path (`createDatasetObject`, `addDatasetFromUpload`, `selectDataset`)

### 4. Exact API request payload (Step 1 Upload)
Source: `frontend/integration.js` (`processSingleUploadFile`)

```js
const formData = new FormData();
formData.append('files', file);
await fetch(`${FREDA.API_BASE}/process`, {
  method: 'POST',
  body: formData
});
```

Request type:
- `multipart/form-data`

Upload endpoint accepts (contract unchanged):
- `files: List[UploadFile]` (primary for Upload step)
- optional `text`, `json_payload`, `user_defined_sources`

### 5. Exact API response payload contract
Backend response model:
- File: `app/models/unified_schemas.py`
- Model: `UnifiedProcessResponse`

Top-level fields:
- `request_id: str`
- `total_inputs: int`
- `processed_results: ProcessedResultEntry[]`
- `summary: object`
- `source_candidates: SourceCandidate[]`
- `candidate_matches: CandidateMatch[]`
- `live_source_results: LiveSourceResult[]`
- `enriched_data: EnrichedData`
- `freshness_analysis: FreshnessAnalysisEntry[]`
- `recommended_changes: RecommendedChange[]`
- `review_required: bool`
- `review_candidates: LiveSourceResult[]`
- `metadata: object`

`ProcessedResultEntry` fields consumed by frontend upload flow:
- `input_name`
- `input_type`
- `status`
- `result`
- `error`
- `processing_time_ms`
- `source`
- `metadata`

## Upload-only migration target (Phase 1)

### Current
`New UI Upload (jf) -> adapter binders in index.html -> integration.js upload pipeline -> POST /api/v1/process -> integration.js state propagation`

### Target
`New UI Upload (jf) -> direct POST /api/v1/process -> New UI local/state binding`

## Direct API calls required for Upload migration
Only one call is required in Phase 1:
- `POST /api/v1/process` with multipart payload containing `files`

## What must be removed from Upload dependency (later implementation phase)
- Upload’s reliance on adapter-level `bindWizardUploadInput()` interception
- Upload’s reliance on `window.handleFileSelection()` UI bridge
- Upload’s reliance on integration.js DOM/status rendering helpers for initial upload step

## Non-goals in this phase
- No changes to backend/services/scrapers/database
- No endpoint contract changes
- No code refactor yet (trace/report only)
