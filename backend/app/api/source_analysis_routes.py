from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from dataclasses import asdict
from datetime import datetime
from urllib.parse import urlparse

from app.site_analyzer import analyse_site
from app.core.database import get_connection
from app.services.admin_request_audit_service import admin_request_audit_service
from app.core.logger import setup_logger

logger = setup_logger(__name__)
router = APIRouter()

class ProjectEstimateRequest(BaseModel):
    name: str = Field(description="Name of the project")
    urls: List[str] = Field(description="List of source URLs")
    datapoints: List[str] = Field(description="List of datapoints to extract")
    frequency: str = Field(description="Crawl frequency (Daily, Weekly, Monthly)")
    format: str = Field(description="Output format (CSV, JSON API, Snowflake, S3)")
    owner: Optional[str] = Field(default=None, description="Business owner email")
    notes: Optional[str] = Field(default=None, description="Additional notes")

    class Config:
        json_schema_extra = {
            "example": {
                "name": "APAC Competitor Pricing",
                "urls": ["https://www.wikidata.org"],
                "datapoints": ["Company name", "Website", "HQ country"],
                "frequency": "Weekly",
                "format": "CSV",
                "owner": "name@company.com",
                "notes": "Regions, QA rules..."
            }
        }

class ProjectEstimateResponse(BaseModel):
    success: bool
    complexity_level: str
    setup_days: int
    first_run_hours: int
    monthly_records: int
    effort: str

@router.post(
    "/analyze",
    summary="Analyze project and return estimates",
    response_model=ProjectEstimateResponse
)
async def analyze_project(request: ProjectEstimateRequest) -> Dict[str, Any]:
    try:
        # Retrieve the first URL to analyze complexity
        url = request.urls[0].strip() if request.urls else ""
        if url and not url.startswith(("http://", "https://")):
            url = f"https://{url}"

        # Initialize defaults
        score = 1
        level = "Easy"
        effort = "1-2 days"
        scraper_type = "Requests + BeautifulSoup"
        has_auth = False
        robots_txt_blocks_scraper = False
        rate_limiting_detected = False
        fingerprinting_signals = False
        captcha_present = False
        js_challenges = False
        blocking_level = "Light"

        # Only run analyzer if it's not a dummy mock URL
        if url and not url.endswith("example.com") and not "localhost" in url:
            try:
                report = analyse_site(
                    target_url=url,
                    max_pages=3,
                    strategy="auto"
                )

                # Check for authentication / login requirements
                url_lower = url.lower()
                name_lower = request.name.lower()

                if any(term in url_lower or term in name_lower for term in ["login", "signin", "auth", "portal", "console", "signup", "register"]):
                    has_auth = True

                for res in report.page_results:
                    pr_url = res.get("url", "").lower() if isinstance(res, dict) else getattr(res, "url", "").lower()
                    if any(term in pr_url for term in ["/login", "/signin", "/signup", "/register", "/auth", "/accounts", "/session"]):
                        has_auth = True
                        break
                    chain = res.get("redirect_chain", []) if isinstance(res, dict) else getattr(res, "redirect_chain", [])
                    for c_url in chain:
                        c_url_lower = c_url.lower()
                        if any(term in c_url_lower for term in ["/login", "/signin", "/signup", "/register", "/auth", "/accounts", "/session"]):
                            has_auth = True
                            break
                    status = res.get("http_status") if isinstance(res, dict) else getattr(res, "http_status", None)
                    if status == 401:
                        has_auth = True
                        break

                if has_auth:
                    score += 5

                # Robots restrictions
                if report.robots_txt_blocks_scraper:
                    score += 2
                    robots_txt_blocks_scraper = True

                # Rate limiting
                if report.rate_limiting_detected:
                    score += 3
                    rate_limiting_detected = True

                # Fingerprinting
                if report.fingerprinting_signals:
                    score += 3
                    fingerprinting_signals = True

                # CAPTCHA
                if report.captcha_present:
                    score += 4
                    captcha_present = True

                # JS challenges / WAF / Cloudflare
                if report.js_challenges:
                    score += 4
                    js_challenges = True
                    if any(waf in [v.lower() for v in report.js_challenges] for waf in ["cloudflare", "akamai", "perimeterx", "datadome", "imperva", "kasada"]):
                        score += 2

                # Social networks check
                social_networks = ["linkedin", "facebook", "instagram", "twitter", "x.com", "tiktok", "reddit", "youtube", "pinterest"]
                is_social = False
                try:
                    domain = urlparse(url).netloc.lower()
                    if any(network in domain for network in social_networks):
                        is_social = True
                except Exception:
                    pass

                if any(network in name_lower for network in social_networks):
                    is_social = True

                if is_social:
                    score = max(score, 10)

                # Map level, scraper type and effort
                if score >= 10:
                    level = "Very Hard"
                    scraper_type = "Playwright + Residential Proxies + CAPTCHA Solver"
                    effort = "2+ weeks"
                elif score >= 7:
                    level = "Hard"
                    scraper_type = "Playwright + Proxy Rotation"
                    effort = "1-2 weeks"
                elif score >= 4:
                    level = "Medium"
                    scraper_type = "Requests + Selenium"
                    effort = "3-5 days"
                else:
                    level = "Easy"
                    scraper_type = "Requests + BeautifulSoup"
                    effort = "1-2 days"

            except Exception as e:
                # Log and fall back to Easy
                logger.warning(f"Site analysis failed for {url}, falling back to Easy: {e}")

        # Calculate estimated KPIs combining complexity level and project scale
        complexity_multipliers = {
            "Easy": 0.8,
            "Medium": 1.2,
            "Hard": 2.0,
            "Very Hard": 3.5
        }
        mult = complexity_multipliers.get(level, 1.0)
        
        sources_count = len(request.urls) if request.urls else 1
        datapoints_count = len(request.datapoints) if request.datapoints else 1
        freq = request.frequency or "Weekly"
        freq_mult = 30.0 if freq == "Daily" else 4.3 if freq == "Weekly" else 1.0

        setup_days = round(sources_count * 1.4 + datapoints_count * 0.18)
        setup_days = int(max(2, round(setup_days * mult)))

        first_run_hours = round(sources_count * 1.8 + datapoints_count * 0.25)
        first_run_hours = int(max(1, round(first_run_hours * mult)))

        base_records = sources_count * datapoints_count
        monthly_records = int(round(base_records * 640 * freq_mult))

        # Record this request in the admin request audit table so the admin sees it
        try:
            import random
            job_id = f"J-REQ-{random.randint(100000, 999999)}"
            
            # Formulate raw payload for audit service
            raw_payload = {
                "source": url,
                "website_url": url,
                "source_name": request.name,
                "scope": "Full Dump",
                "frequency": freq,
                "delivery": "S3 bucket" if request.format == "S3" else request.format,
                "output_format": "JSON" if request.format == "JSON API" else request.format,
                "filters": "—",
                "custom_criteria": request.notes or "—",
                "mode": "Site-Specific",
                "isCustomSource": True,
                "owner_username": request.owner or "user",
                "input_data": None,
            }
            
            # Save request to database
            admin_request_audit_service.record_request(
                job_id=job_id,
                request_type="By Source",
                source=url,
                dataset_name=None,
                mode="Site-Specific",
                scope="Full Dump",
                user={"username": request.owner or "user", "role": "user", "display_name": "FreshData User"},
                raw_payload=raw_payload,
                planner_status="supported",
                request_status="Estimating",
                job_status="Pending Onboarding",
                status_reason=f"Auto-generated estimate via Site Analyzer bot: Complexity {level}",
                execution_metadata={
                    "complexity": level,
                    "estimated_onboarding_time": effort,
                    "records": monthly_records,
                }
            )

            # Insert a pending job in scraper_jobs so it mirrors in the database correctly
            now_str = datetime.utcnow().isoformat() + "Z"
            with get_connection() as conn:
                conn.execute(
                    """INSERT INTO scraper_jobs (id, source, scope, filters, custom_criteria, frequency, delivery, 
                                                output_format, dataset_path, status, created_at, is_custom_source, mode, complexity, estimated_onboarding_time, owner_username)
                       VALUES (?, ?, 'Full Dump', '—', ?, ?, ?, ?, ?, 'Pending Onboarding', ?, 1, 'Site-Specific', ?, ?, ?)""",
                    (job_id, url, request.notes or "—", freq, request.format, "JSON" if request.format == "JSON API" else request.format,
                     f"datasets/{request.name.lower()}_sample.csv", now_str, level, effort, request.owner or "user")
                )
                conn.commit()

        except Exception as audit_err:
            logger.warning(f"Failed to record request in DB: {audit_err}")

        return {
            "success": True,
            "complexity_level": level,
            "setup_days": setup_days,
            "first_run_hours": first_run_hours,
            "monthly_records": monthly_records,
            "effort": effort
        }

    except Exception as e:
        logger.error(f"Error in analyze_project: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while running the source analyzer: {str(e)}"
        )
