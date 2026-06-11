import sys
import asyncio
import json

sys.path.insert(0, '.')

import app.services.registry_scrapers.sec_scraper as sec_mod
from app.services.workflow_service import workflow_service


async def apple_flow():
    company = 'Apple'
    print('--- APPLE: resolving CIK via company tickers ---')
    tickers = await sec_mod.sec_scraper._get_company_tickers()
    # find apple entry
    apple_entry = None
    for key, item in tickers.items():
        title = (item.get('title') or '').lower()
        if 'apple' in title:
            apple_entry = item
            break
    if not apple_entry:
        print('Apple entry not found in tickers')
        return
    cik = apple_entry.get('cik_str')
    cik_norm = sec_mod._normalize_cik(cik)
    sec_url = sec_mod.SEC_SUBMISSIONS_URL.format(cik=cik_norm)
    print('Exact SEC request executed:', sec_url)
    submission = await sec_mod.sec_scraper._request_json(sec_url)
    print('\n--- RAW SEC response (truncated) ---')
    print(json.dumps(submission if isinstance(submission, dict) else {}, indent=2)[:8000])
    parsed = sec_mod.sec_scraper._extract_fields(submission, {'cik': cik_norm, 'title': apple_entry.get('title')})
    print('\n--- Parsed SEC metadata ---')
    print(json.dumps(parsed, indent=2))

    print('\n--- Running workflow for Apple to get Review Queue and processed_dataset ---')
    dataset = { 'id': 'apple_run', 'name': 'apple.csv', 'records': [ {'company_name': 'Apple', 'country': 'US'} ] }
    config = { 'selectedWorkflows': ['Website Verification'], 'prioritySources': ['SEC/MCA', 'LinkedIn'], 'requestedOutputFields': ['company_name','cik','ticker','linkedin_url'] }
    summary = await workflow_service.run_workflow(dataset, config)
    print('\n--- Review Entries ---')
    print(json.dumps(summary.get('review_entries', []), indent=2))
    print('\n--- Processed Dataset ---')
    print(json.dumps(summary.get('processed_dataset', []), indent=2))


async def microsoft_flow():
    company = 'Microsoft'
    print('\n--- MICROSOFT: performing LinkedIn search evidence discovery ---')
    discovery = workflow_service._discover_linkedin_search_evidence(company)
    # _discover_linkedin_search_evidence is synchronous (non-async) so it returns directly
    print('\n--- LinkedIn discovery raw result ---')
    print(json.dumps(discovery, indent=2))

    print('\n--- Running workflow for Microsoft to ensure LinkedIn evidence appears in review ---')
    dataset = { 'id': 'msft_run', 'name': 'msft.csv', 'records': [ {'company_name': 'Microsoft', 'country': 'US'} ] }
    config = { 'selectedWorkflows': ['Website Verification'], 'prioritySources': ['LinkedIn', 'SEC/MCA'], 'requestedOutputFields': ['company_name','linkedin_url','cik','ticker'] }
    summary = await workflow_service.run_workflow(dataset, config)
    print('\n--- Review Entries ---')
    print(json.dumps(summary.get('review_entries', []), indent=2))
    print('\n--- Processed Dataset ---')
    print(json.dumps(summary.get('processed_dataset', []), indent=2))


async def main():
    await apple_flow()
    await microsoft_flow()


if __name__ == '__main__':
    asyncio.run(main())
