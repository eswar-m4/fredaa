import os
import sys
import time
import asyncio
import pandas as pd

# Add workspace directory to python path to import scraper
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from app.services.registry_scrapers.sec_scraper import sec_scraper

base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
csv_path = os.path.join(base_dir, "sample_sec.csv")
xlsx_path = os.path.join(base_dir, "sample_sec.xlsx")

# 30 major public companies spanning multiple industries
tickers = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "NFLX", "ORCL", "ADBE",
    "CRM", "IBM", "INTC", "AMD", "CSCO", "PEP", "KO", "DIS", "JNJ", "WMT",
    "PG", "V", "MA", "HD", "BAC", "XOM", "CVX", "JPM", "UNH", "COST"
]

COLUMNS = [
    "entity_name", "cik", "ticker", "website", "sic", "sic_description",
    "state_of_incorporation", "fiscal_year_end", "phone", "business_address",
    "mailing_address", "filing_type", "filing_date", "filing_document_link"
]

def format_address(addr_dict):
    if not addr_dict or not isinstance(addr_dict, dict):
        return None
    parts = [
        addr_dict.get("street1"),
        addr_dict.get("street2"),
        addr_dict.get("city"),
        addr_dict.get("stateOrCountry"),
        addr_dict.get("zipCode")
    ]
    return ", ".join(str(p).strip() for p in parts if p and str(p).strip())

def format_filing_link(cik, accession_number, primary_document):
    if not cik or not accession_number or not primary_document:
        return None
    cik_numeric = str(cik).lstrip("0")
    accession_numeric = str(accession_number).replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik_numeric}/{accession_numeric}/{primary_document}"

async def main():
    records = []
    print(f"Scraping SEC EDGAR metadata for {len(tickers)} companies...")
    
    for idx, ticker in enumerate(tickers):
        print(f"[{idx+1}/{len(tickers)}] Querying: {ticker}")
        try:
            # Query SEC Scraper
            result = await sec_scraper.lookup_company("", ticker=ticker)
            fields = result.get("extracted_fields") or {}
            
            if fields.get("entity_name"):
                profile = fields.get("profile") or {}
                filings = fields.get("filings") or []
                first_filing = filings[0] if filings else {}
                
                # Format addresses
                bus_addr = format_address(profile.get("business_address"))
                mail_addr = format_address(profile.get("mailing_address"))
                
                # Format filing document URL
                doc_link = format_filing_link(
                    fields.get("cik"),
                    first_filing.get("accession_number"),
                    first_filing.get("primary_document")
                )
                
                rec = {
                    "entity_name": fields.get("entity_name"),
                    "cik": fields.get("cik"),
                    "ticker": fields.get("ticker"),
                    "website": fields.get("website"),
                    "sic": fields.get("sic"),
                    "sic_description": fields.get("sic_description"),
                    "state_of_incorporation": fields.get("state_of_incorporation"),
                    "fiscal_year_end": fields.get("fiscal_year_end"),
                    "phone": profile.get("phone"),
                    "business_address": bus_addr,
                    "mailing_address": mail_addr,
                    "filing_type": first_filing.get("filing_type"),
                    "filing_date": first_filing.get("filing_date"),
                    "filing_document_link": doc_link
                }
                records.append(rec)
                print(f"  Successfully retrieved: {rec['entity_name']}")
            else:
                print("  Filer not found")
        except Exception as e:
            print(f"  Error: {e}")
            
        # 0.15s delay to be safe and polite with SEC EDGAR requests
        await asyncio.sleep(0.15)
        
    print(f"Total parsed records: {len(records)}")
    
    # Save to CSV and Excel
    df_out = pd.DataFrame(records, columns=COLUMNS)
    df_out = df_out.where(pd.notnull(df_out), None)
    
    df_out.to_csv(csv_path, index=False)
    df_out.to_excel(xlsx_path, index=False)
    print("Saved SEC datasets to disk.")

if __name__ == "__main__":
    asyncio.run(main())
