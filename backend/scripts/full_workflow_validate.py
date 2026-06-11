import sys
import asyncio
import json
import time
from pathlib import Path

sys.path.insert(0, '.')

import app.services.registry_scrapers.sec_scraper as sec_mod
from app.services.workflow_service import workflow_service

OUTPUT = Path('data/validation_results.json')

async def apple():
    company = 'Apple'
    tickers = await sec_mod.sec_scraper._get_company_tickers()
    apple_entry = None
    for key, item in tickers.items():
        title = (item.get('title') or '').lower()
        if 'apple' in title:
            apple_entry = item
            break
    if not apple_entry:
        raise RuntimeError('Apple entry not found in tickers')
    cik = apple_entry.get('cik_str')
    cik_norm = sec_mod._normalize_cik(cik)
    sec_url = sec_mod.SEC_SUBMISSIONS_URL.format(cik=cik_norm)
    submission = await sec_mod.sec_scraper._request_json(sec_url)
    parsed = sec_mod.sec_scraper._extract_fields(submission, {'cik': cik_norm, 'title': apple_entry.get('title')})

    dataset = { 'id': 'apple_run', 'name': 'apple.csv', 'records': [ {'company_name': 'Apple', 'country': 'US'} ] }
    config = { 'selectedWorkflows': ['Website Verification'], 'prioritySources': ['SEC/MCA', 'LinkedIn'], 'requestedOutputFields': ['company_name','cik','ticker','linkedin_url'] }
    summary = await workflow_service.run_workflow(dataset, config)

    return {
        'company': company,
        'sec_url': sec_url,
        'sec_submission_snippet': json.dumps(submission)[:8000],
        'sec_submission': submission,
        'parsed_fields': parsed,
        'summary': summary,
    }


def try_linkedin_discovery(target, attempts=5, delay=3):
    for i in range(attempts):
        res = workflow_service._discover_linkedin_search_evidence(target)
        if res:
            return res
        time.sleep(delay)
    return {}

async def microsoft():
    company = 'Microsoft'
    discovery = try_linkedin_discovery(company, attempts=5, delay=2)

    dataset = { 'id': 'msft_run', 'name': 'msft.csv', 'records': [ {'company_name': 'Microsoft', 'country': 'US'} ] }
    config = { 'selectedWorkflows': ['Website Verification'], 'prioritySources': ['LinkedIn', 'SEC/MCA'], 'requestedOutputFields': ['company_name','linkedin_url','cik','ticker'] }
    summary = await workflow_service.run_workflow(dataset, config)

    return {
        'company': company,
        'discovery': discovery,
        'summary': summary,
    }

async def main():
    out = {}
    out['apple'] = await apple()
    out['microsoft'] = await microsoft()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(out, indent=2))
    print('Wrote', OUTPUT)

if __name__ == '__main__':
    asyncio.run(main())
