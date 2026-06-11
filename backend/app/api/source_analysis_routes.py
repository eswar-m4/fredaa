from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from dataclasses import asdict

from app.site_analyzer import analyse_site

router = APIRouter()

class SourceAnalysisRequest(BaseModel):
    source_name: str = Field(description="Name of the data source (e.g. Keysight)")
    website_url: str = Field(description="Starting URL to analyze")
    pages_to_scan: Optional[int] = Field(default=10, description="Max pages to crawl/scan")

    class Config:
        json_schema_extra = {
            "example": {
                "source_name": "Keysight",
                "website_url": "https://www.keysight.com",
                "pages_to_scan": 10
            }
        }

@router.post(
    "/analyze",
    summary="Run Source Analyzer and get a structured Source Assessment Report",
    description="Crawls the target site to check for robots.txt rules, HTTP blocking, CAPTCHA, JS challenges, rate limits, and fingerprinting."
)
async def analyze_source(request: SourceAnalysisRequest):
    try:
        url = request.website_url.strip()
        pages = request.pages_to_scan or 10

        # Run the existing site_analyzer logic
        report = analyse_site(
            target_url=url,
            max_pages=pages,
            strategy="auto"
        )

        # Check if the website was completely unreachable (e.g. DNS lookup failure, host unreachable)
        first_page_failed = False
        if report.page_results:
            first_page = report.page_results[0]
            if first_page.get("http_status") is None:
                first_page_failed = True
        else:
            first_page_failed = True

        if first_page_failed:
            err_msg = report.page_results[0].get("block_reason") if report.page_results else "Connection failed"
            raise HTTPException(
                status_code=400,
                detail=f"The website could not be reached or does not exist. Details: {err_msg}"
            )

        # 1. Complexity Score Calculation
        from urllib.parse import urlparse

        score = 1

        # Check for authentication / login requirements
        url_lower = url.lower()
        source_name_lower = request.source_name.lower()
        has_auth = False

        if any(term in url_lower or term in source_name_lower for term in ["login", "signin", "auth", "portal", "console", "signup", "register"]):
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

        # Rate limiting
        if report.rate_limiting_detected:
            score += 3

        # Fingerprinting
        if report.fingerprinting_signals:
            score += 3

        # CAPTCHA
        if report.captcha_present:
            score += 4

        # JS challenges / WAF / Cloudflare
        if report.js_challenges:
            score += 4
            # Additional score for heavy/known WAFs
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

        if any(network in source_name_lower for network in social_networks):
            is_social = True

        if is_social:
            score = max(score, 10)  # Always at least Very Hard (score >= 10)

        # 2. Map level, scraper type and effort
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

        # Determine blocking level: Severe, Heavy, Moderate, Light
        blocking_level = "Light"
        has_heavy_waf = any(waf in [v.lower() for v in report.js_challenges] for waf in ["cloudflare", "akamai", "perimeterx", "datadome", "imperva", "kasada"])
        
        if report.captcha_present or has_heavy_waf:
            blocking_level = "Severe"
        elif report.js_challenges or report.fingerprinting_signals:
            blocking_level = "Heavy"
        elif report.rate_limiting_detected or report.robots_txt_blocks_scraper:
            blocking_level = "Moderate"
        else:
            blocking_level = "Light"

        # 3. Strategy Flags
        requests_only = (level == "Easy")
        selenium_required = (level == "Medium")
        playwright_required = (level in ("Hard", "Very Hard"))
        proxy_required = (level in ("Hard", "Very Hard") or report.rate_limiting_detected or report.overall_blocking in ("soft", "hard"))
        captcha_solver_required = report.captcha_present

        # 4. Map characteristics
        site_characteristics = {
            "robots_txt_blocks_scraper": report.robots_txt_blocks_scraper,
            "overall_blocking": report.overall_blocking,
            "blocking_behavior": report.blocking_behavior,
            "captcha_present": report.captcha_present,
            "captcha_types": report.captcha_types,
            "js_challenges": report.js_challenges,
            "rate_limiting_detected": report.rate_limiting_detected,
            "fingerprinting_signals": report.fingerprinting_signals,
            "auth_required": has_auth,
            "blocking_level": blocking_level
        }

        recommended_strategy = {
            "requests_only": requests_only,
            "selenium_required": selenium_required,
            "playwright_required": playwright_required,
            "proxy_required": proxy_required,
            "captcha_solver_required": captcha_solver_required
        }

        # 5. Return structured JSON matching requirements
        return {
            "source_name": request.source_name,
            "website_url": request.website_url,
            "analysis_summary": {
                "complexity_score": score,
                "complexity_level": level,
                "recommended_scraper_type": scraper_type,
                "estimated_development_effort": effort
            },
            "site_characteristics": site_characteristics,
            "recommended_strategy": recommended_strategy,
            "recommendations": report.recommendations,
            "raw_report": asdict(report)
        }

    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"An error occurred while running the source analyzer: {str(e)}"
        )
