import sys
import asyncio
import json
sys.path.insert(0, '.')

from app.services.workflow_service import workflow_service

async def run():
    dataset = {
        "id": "real-src-1",
        "name": "real-src.csv",
        "records": [
            {"company_name": "Apple", "country": "US"},
            {"company_name": "Microsoft", "country": "US"},
        ],
    }
    config = {
        "selectedWorkflows": ["Website Verification"],
        "prioritySources": ["SEC/MCA", "LinkedIn"],
        "requestedOutputFields": ["company_name", "cik", "ticker", "linkedin_url"],
        "concurrency": 2,
    }
    print('Starting real connector run...')
    summary = await workflow_service.run_workflow(dataset, config)
    # Dump relevant outputs
    print('\n=== RECORD RESULTS (raw) ===')
    print(json.dumps(summary.get('record_results'), indent=2))
    print('\n=== PROCESSED DATASET ===')
    print(json.dumps(summary.get('processed_dataset'), indent=2))
    print('\n=== REVIEW ENTRIES ===')
    print(json.dumps(summary.get('review_entries'), indent=2))

if __name__ == '__main__':
    asyncio.run(run())
