# New UI Direct API Migration Plan

## Scope
- Keep backend/services/APIs unchanged.
- Keep current new UI design in `frontend/index.html`.
- Plan only: migrate from mixed legacy adapter/DOM patch path to direct New UI -> API calls.

---

## 1) Backend API Endpoints Already Available

From `app/api/routes.py`:

### Core current endpoints
- `GET /api/v1/health`
- `POST /api/v1/process`
- `POST /api/v1/workflows/run`
- `POST /api/v1/workflows/preflight-analysis`
- `POST /api/v1/workflows/field-mapping-suggestions`
- `POST /api/v1/workflows/verify-record`
- `GET /api/v1/workflows/review-queue`
- `GET /api/v1/workflows/review-queue/{dataset_id}`
- `GET /api/v1/export`
- `POST /api/v1/workflows/confidence-report-html/download`
- `POST /api/v1/workflows/confidence-report-html/source-highlighted/download`
- `POST /api/v1/workflows/batch-process`
- `GET /api/v1/reviews`
- `GET /api/v1/reviews/{review_id}`
- `POST /api/v1/reviews/{review_id}/approve`
- `POST /api/v1/reviews/{review_id}/reject`
- `POST /api/v1/reviews/{review_id}/edit`
- `GET /api/v1/audit`

### Legacy compatibility endpoints (still present)
- `POST /api/v1/upload`
- `POST /api/v1/process-input`
- `POST /api/v1/process-file`
- `POST /api/v1/infer-schema`
- `POST /api/v1/normalize-data`

---

## 2) `integration.js` Functions Currently Used by New UI

## 2.1 Functions directly relevant to current New UI flow
- `handleFileSelection(...)`
- `uploadFiles(...)`
- `processSingleUploadFile(...)`
- `handleProcessResult(...)`
- `createDatasetObject(...)`
- `addDatasetFromUpload(...)`
- `selectDataset(...)`
- `renderFieldMappingPage(...)`
- `mappedSupersetFieldForHeader(...)`
- `requestQwenFieldMappingSuggestions(...)`
- `getRequestedOutputFields(...)`
- `setRequestedOutputFields(...)`
- `buildWorkflowPayload(...)`
- `runWorkflow(...)` / `window.runWorkflow(...)`
- `updateWorkflowMonitor(...)`
- `preferredMonitoringRun(...)`
- `rowsFromSummary(...)`
- `applyWorkflowSummary(...)`
- `syncReviewQueueFromDataset(...)`
- `triggerWorkflowExport(...)`
- `FREDA.exportProcessedDataset(...)`

## 2.2 Classification

### A) Pure API wrappers / API-calling helpers
- `processSingleUploadFile` -> `POST /process` (fallback `/upload`)
- `requestQwenFieldMappingSuggestions` -> `POST /workflows/field-mapping-suggestions`
- `FREDA.analyzeWorkflowPreflight` -> `POST /workflows/preflight-analysis`
- `runWorkflow` -> `POST /workflows/run`
- `FREDA.downloadHighlightedSourceHtml` -> `POST /workflows/confidence-report-html/source-highlighted/download`
- `triggerWorkflowExport` / `FREDA.exportProcessedDataset` -> `GET /export`

### B) UI logic
- `renderFieldMappingPage`
- `refreshExportBindings`
- Review/render helpers that format display data

### C) State management
- `createDatasetObject`
- `addDatasetFromUpload`
- `selectDataset`
- `setRequestedOutputFields`
- `applyWorkflowSummary`
- `rowsFromSummary`
- `syncReviewQueueFromDataset`
- `updateWorkflowMonitor`
- `preferredMonitoringRun`

### D) DOM manipulation / legacy patch path
- Manual selectors/binding functions in `index.html` adapter block:
  - `bindWizardRunWorkflowAction`
  - `syncReviewExportPage`
  - `syncMonitorCardInline`
  - `[data-freda-live-monitor]`
  - `[data-freda-live-review-queue]`
- These are not API features; these are legacy DOM-bridge behavior.

---

## 3) Current vs Target Architecture

## Step 1: Upload
### Current
`New UI` -> event binding bridge -> `integration.js handleFileSelection/uploadFiles/processSingleUploadFile` -> `POST /api/v1/process` (fallback `/upload`)

### Target
`New UI` -> direct API call `POST /api/v1/process` -> update React state (`dataset`, `columns`, `preview rows`) directly.

### Required API calls
- `POST /api/v1/process`

---

## Step 2: Configure Dataset (mapping + attributes)
### Current
`New UI` + bridge/interop -> integration state -> exact-match + `requestQwenFieldMappingSuggestions` -> backend suggestions API.

### Target
`New UI` owns mapping state directly:
- exact match locally
- fallback to `POST /api/v1/workflows/field-mapping-suggestions`
- preflight optional via `POST /api/v1/workflows/preflight-analysis`
- attributes saved in React state + persisted to workflow config payload.

### Required API calls
- `POST /api/v1/workflows/field-mapping-suggestions`
- optional `POST /api/v1/workflows/preflight-analysis`

---

## Step 3: Configure Workflow
### Current
`New UI` -> DOM bridge click interception -> `window.runWorkflow` in integration -> `buildWorkflowPayload` -> `POST /api/v1/workflows/run`.

### Target
`New UI` launch button directly constructs payload (same contract) -> `POST /api/v1/workflows/run`.

### Required API calls
- `POST /api/v1/workflows/run`

Payload includes existing fields already used:
- dataset id/name
- selected workflows
- requested output fields
- thresholds
- priority sources/custom sources
- sync/export targets

---

## Step 4: Review & Export
### Current
Mixed rendering:
- React bundled demo data arrays in `index.html` (`hf`, `vf`, etc.)
- adapter patches monitor/review DOM with `data-freda-live-*`
- integration state (`FREDA.workflowRuns`, `workflowReviewRows`, `window.reviewData`) injected into visible DOM.

### Target
`New UI` renders only from real state:
- monitor from workflow run response/state (`status`, `progress`, timestamps)
- queue from `workflowReviewRows` (or `GET /workflows/review-queue/{dataset_id}`)
- preview from real row `field comparisons`
- export button calls existing export endpoint.

### Required API calls
- `GET /api/v1/workflows/review-queue/{dataset_id}` (or existing in-memory result from run summary)
- `POST /api/v1/workflows/confidence-report-html/source-highlighted/download`
- `GET /api/v1/export`

---

## 4) What Must Be Removed in Migration (No backend changes)

- Legacy DOM patching block in `frontend/index.html` adapter section:
  - runtime DOM discovery and node injection
  - legacy selector coupling (`findCardByHeadingText`, `fallbackMonitorCard`, etc.)
  - `data-freda-live-monitor` mount
  - `data-freda-live-review-queue` mount
- Any review/demo arrays in the bundled UI (`hf`, `vf`, placeholder monitor rows) as data sources for visible Step 4.

---

## 5) Direct API Wiring Checklist by Page

## Upload (Step 1)
- [ ] Button/input dispatches directly to upload API handler in New UI.
- [ ] API response sets selected dataset + columns in New UI state.

## Configure Dataset (Step 2)
- [ ] Mapping table sourced from selected dataset columns.
- [ ] Unmapped headers trigger suggestions API.
- [ ] Selected attributes saved in New UI state for workflow payload.

## Configure Workflow (Step 3)
- [ ] Priority sources stored in New UI state.
- [ ] Launch button directly calls `/workflows/run` with same payload contract.

## Review & Export (Step 4)
- [ ] Monitor binds to real run state, no DOM patch fallback.
- [ ] Queue binds to real rows only (dataset scoped).
- [ ] Preview binds to row comparison payloads.
- [ ] Export button calls existing export endpoint.

---

## 6) Practical Migration Order (lowest risk)
1. Keep existing APIs and payload contract unchanged.
2. Replace Step 4 data source first (remove demo + adapter dependency).
3. Replace Step 3 launch wiring (button -> direct `/workflows/run`).
4. Replace Step 2 mapping API usage directly in New UI state.
5. Replace Step 1 upload wiring directly in New UI state.
6. Remove legacy DOM bridge code only after parity checks pass.

---

## 7) Summary
- Backend is already sufficient for direct New UI integration.
- Main risk is mixed rendering state (React demo state + adapter DOM injection).
- Target architecture should be:
  - `New UI (React state)` -> `existing backend APIs`
  - no legacy DOM patch adapters
  - no old UI injection dependency.
