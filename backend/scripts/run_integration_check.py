import sys
from unittest.mock import AsyncMock, patch
import asyncio

sys.path.insert(0, '.')

from app.services.workflow_service import workflow_service

async def main():
    records = [
        {"company_name": "Apple"},
        {"company_name": "Microsoft"},
        {"company_name": "OpenAI"},
        {"company_name": "Infosys"},
    ]
    dataset = {"id": "src-integration-dataset","name":"source-integration.csv","records": records}
    config = {
        "selectedWorkflows": ["Website Verification"],
        "prioritySources": ["SEC/MCA", "LinkedIn"],
        "requestedOutputFields": ["company_name","cik","ticker","cin","company_status","linkedin_url"],
    }

    def fake_linkedin_discovery(company):
        m = {
            "microsoft": "https://www.linkedin.com/company/microsoft",
            "apple": "https://www.linkedin.com/company/apple",
            "openai": "https://www.linkedin.com/company/openai",
            "infosys": "https://www.linkedin.com/company/infosys",
        }
        key = str(company or '').strip().lower()
        url = m.get(key, '')
        if not url:
            return {}
        return {"linkedin_url": url, "query": f"{company} LinkedIn company","backend":"api","metadata": {"linkedin_url": url, "linkedin_company_name": company, "linkedin_description": f"{company} profile"}}

    async def fake_sec_lookup(company, cik=None, ticker=None):
        return {"source_type":"government_registry","registry_source":"sec_edgar","registry_confidence":0.91,"extracted_fields":{"cik":"0000789019","ticker":"MSFT"},"raw_metadata":{"status":"success"}}

    async def fake_mca_lookup(company):
        return {"source_type":"government_registry","registry_source":"mca_india","registry_confidence":0.92,"extracted_fields":{"cin":"L85110KA1981PLC013115","company_status":"Active"},"raw_metadata":{"status":"success"}}

    with patch.object(workflow_service, '_discover_linkedin_search_evidence', side_effect=fake_linkedin_discovery):
        import importlib
        ro_module = importlib.import_module('app.services.registry_scrapers.registry_orchestrator')
        # patch the underlying scraper lookup functions on the module
        ro_module.sec_scraper.lookup_company = AsyncMock(side_effect=fake_sec_lookup)
        ro_module.mca_scraper.lookup_company = AsyncMock(side_effect=fake_mca_lookup)
        result = await workflow_service.run_workflow(dataset, config)
        print('Run summary:')
        print('total:', result.get('total'))
        for idx,row in enumerate(result.get('record_results') or []):
            print(idx, row.get('company'), 'linkedin_source:', row.get('linkedin_source'), 'registry', row.get('registry_metadata',{}).get('registry_source'))

if __name__ == '__main__':
    asyncio.run(main())
