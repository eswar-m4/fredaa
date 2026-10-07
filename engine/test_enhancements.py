import os
import sys
from pathlib import Path

os.environ.setdefault("FREDA_SEMANTIC", "0")

sys.path.insert(0, str(Path(__file__).resolve().parent))

from extract_req import classify_intent, extract_requirement, scope_summary
from match_scope import match_capabilities
from questions import apply_answer, family_for, next_question


def mini_catalog() -> dict:
    return {
        "agents": [
            {
                "id": "12",
                "name": "BSE",
                "category": "Registry & SEC",
                "industry": "Financial",
                "dataType": "Filings",
                "description": "BSE corporate filings",
                "country": "India",
                "hostname": "bseindia.com",
                "sourceUrl": "https://bseindia.com",
            }
        ],
        "sources": [
            {"solutionId": "ds-financial", "name": "BSE Corporate Filings", "region": "IN"},
            {"solutionId": "ds-financial", "name": "NSE Corporate Filings", "region": "IN"},
            {"solutionId": "ds-hospitality-venues", "name": "MakeMyTrip", "region": "IN"},
        ],
        "solutions": [
            {
                "id": "ds-firmographic",
                "name": "Firmographic Data",
                "category": "Company",
                "tagline": "Full company profile — 30+ attributes",
                "description": "Canonical B2B company record covering identity, industry, size, leadership",
                "sourceNames": ["Company Website", "LinkedIn Company Page"],
                "attributes": ["Legal Name", "Industry", "Year Founded", "HQ Address", "Phone"],
                "countriesCovered": "64",
                "refreshCadence": "Monthly",
                "sourceCount": "21",
            },
            {
                "id": "ds-registry",
                "name": "Company Registry / Compliance",
                "category": "Company",
                "tagline": "Registry IDs, directors, filings, beneficial owners",
                "description": "Authoritative registry records across Companies House, MCA",
                "sourceNames": ["MCA (India)"],
                "attributes": ["Registry Number", "Directors", "Filings"],
                "countriesCovered": "80",
                "refreshCadence": "Monthly",
                "sourceCount": "6",
            },
            {
                "id": "ds-funding",
                "name": "Funding & Investment",
                "category": "Financial",
                "tagline": "Rounds, investors, valuations, cap table",
                "description": "Funding history per company: round type, amount raised, lead investor",
                "sourceNames": ["Crunchbase"],
                "attributes": ["Round Type", "Amount Raised (USD)", "Lead Investor"],
                "countriesCovered": "90",
                "refreshCadence": "Weekly",
                "sourceCount": "5",
            },
            {
                "id": "ds-us-public-school-district-workforce",
                "name": "US Public School District Workforce",
                "category": "Education",
                "tagline": "K-12 district staff, contacts, and salary schedules",
                "description": "US public K-12 district workforce records covering district identity and staff profiles",
                "sourceNames": ["NCES Common Core of Data"],
                "attributes": ["District Name", "School Name", "Staff Title", "Subject Taught", "Email", "Phone"],
                "countriesCovered": "US",
                "refreshCadence": "Monthly",
                "sourceCount": "5",
            },
            {
                "id": "ds-financial",
                "name": "Financial Statements (Annual Reports)",
                "category": "Financial",
                "tagline": "100+ KPIs from 10-K / 10-Q / annual reports",
                "description": "Deeply structured financials extracted from annual reports",
                "sourceNames": ["BSE Corporate Filings", "NSE Corporate Filings", "SEC EDGAR"],
                "attributes": ["Filing Type", "Fiscal Year", "Total Revenue"],
                "countriesCovered": "42",
                "refreshCadence": "Quarterly",
                "sourceCount": "12",
            },
            {
                "id": "ds-attorney-details",
                "name": "Attorney & Law Firm Details",
                "category": "Legal",
                "tagline": "Advocates, practice areas, bar registration, fees",
                "description": "Advocate and law-firm master",
                "sourceNames": ["LawRato"],
                "attributes": ["Attorney Name", "Practice Areas"],
                "countriesCovered": "9",
                "refreshCadence": "Monthly",
                "sourceCount": "14",
            },
            {
                "id": "ds-healthcare-providers",
                "name": "Hospitals, Clinics & Doctors",
                "category": "Healthcare",
                "tagline": "Providers, specialities, consult fees, accreditation",
                "description": "Provider master for hospitals, clinics, diagnostic labs and individual practitioners",
                "sourceNames": ["Practo", "Hospital / clinic website (official)"],
                "attributes": ["Provider Name", "Speciality", "Departments", "Doctors Listed", "Accreditation (NABH / JCI)"],
                "countriesCovered": "12",
                "refreshCadence": "Weekly",
                "sourceCount": "12",
            },
            {
                "id": "ds-hospitality-venues",
                "name": "Hotels, Restaurants & Venues",
                "category": "Hospitality",
                "tagline": "Tariffs, menus, amenities, review scores",
                "description": "Hotel, resort and restaurant profiles with live tariffs",
                "sourceNames": ["MakeMyTrip", "Booking.com"],
                "attributes": ["Nightly Price", "Amenities", "Star Rating"],
                "countriesCovered": "48",
                "refreshCadence": "Daily",
                "sourceCount": "13",
            },
            {
                "id": "ds-travel",
                "name": "Travel & Hospitality",
                "category": "Travel",
                "tagline": "Hotel/flight prices, availability, reviews",
                "description": "Hotel & flight pricing, availability and reviews across OTA sites",
                "sourceNames": ["Booking.com", "Expedia"],
                "attributes": ["Nightly Price", "Availability", "Reviews"],
                "countriesCovered": "65",
                "refreshCadence": "Hourly",
                "sourceCount": "4",
            },
        ],
    }


def test_tech_companies_extraction():
    req = extract_requirement("List of Tech companies in India with Address and phone number")
    assert req["entityType"] == "Companies"
    assert req["industry"] == "Technology"
    assert req["geography"] == "India"
    assert "Address" in req["attributes"]
    assert any("Phone" in item for item in req["attributes"])
    assert not any("India" in item for item in req["attributes"])
    assert classify_intent("List of Tech companies in India with Address and phone number") == "find_existing"


def test_tech_companies_matches_firmographic():
    req = extract_requirement("List of Tech companies in India with Address and phone number")
    matched = match_capabilities("List of Tech companies in India with Address and phone number", req, mini_catalog())
    names = [s["name"] for s in matched["solutions"]]
    assert "Firmographic Data" in names
    assert "Company Registry / Compliance" not in names
    assert "Financial Statements (Annual Reports)" not in names
    assert "Attorney & Law Firm Details" not in names
    assert matched["kind"] in {"existing", "partial"}


def test_hotels_extraction_and_match():
    text = "Show me hotels with pricing in India"
    req = extract_requirement(text)
    assert req["entityType"] == "Hotels"
    assert req["geography"] == "India"
    assert req["attributes"] == ["Pricing"]
    assert classify_intent(text) == "find_existing"
    matched = match_capabilities(text, req, mini_catalog())
    names = [s["name"] for s in matched["solutions"]]
    assert "Hotels, Restaurants & Venues" in names
    assert "Travel & Hospitality" in names
    assert matched["kind"] in {"existing", "partial"}


def test_hotels_questions_skip_known():
    req = extract_requirement("Show me hotels with pricing in India")
    q1 = next_question("hospitality", req, [])
    assert q1 and q1["field"] == "category"
    req = apply_answer(req, "category", "5-star")
    q2 = next_question("hospitality", req, ["category"])
    assert q2 and q2["field"] == "frequency"
    req = apply_answer(req, "frequency", "Hourly")
    q3 = next_question("hospitality", req, ["category", "frequency"])
    assert q3 is None
    summary = scope_summary(req)
    assert summary["Entity"] == "Hotels"
    assert summary["Geography"] == "India"
    assert "Pricing" in summary["Required data"]
    assert "Hourly" in summary["Frequency"]
    assert "Which outputs do you need" not in summary


def test_all_available_fields_not_exploded():
    req = extract_requirement("Show me hotels with pricing in India")
    req = apply_answer(
        req,
        "attributes",
        "Tariffs; Availability; Amenities; Menus; Review scores; All available fields",
        ["Tariffs", "Availability", "Amenities", "Menus", "Review scores", "All available fields"],
    )
    assert req["attributes"] == ["All available fields"]


def test_annual_reports_sources_preserved():
    text = "I need annual reports from BSE, NSE and company websites"
    req = extract_requirement(text)
    assert req["entityType"] == "Annual reports"
    assert req["sources"] == ["BSE", "NSE", "Company websites"]
    assert req["geography"] == "India"
    matched = match_capabilities(text, req, mini_catalog())
    names = [s["name"] for s in matched["solutions"]]
    assert names[0] == "Financial Statements (Annual Reports)"
    assert matched["kind"] == "partial"
    details = " ".join(g["detail"] for g in matched["gaps"])
    assert "NSE" in details
    assert "Company websites" in details
    q1 = next_question("financial", req, [])
    assert q1 and q1["field"] == "extras.reportKind"
    assert "geography" not in (q1["field"] or "")


def test_questions_are_generated_for_entity_not_a_bank():
    hotels = extract_requirement("Show me hotels with pricing in India")
    companies = extract_requirement("List of Tech companies in India with Address and phone number")
    hq = next_question("hospitality", hotels, [])
    cq = next_question("firmographic", companies, [])
    assert hq and cq
    assert hq["field"] != cq["field"] or hq["choices"] != cq["choices"]
    assert "5-star" in hq["choices"]
    assert "SaaS" in cq["choices"]
    catalog_q = next_question(
        "hospitality",
        {
            "entityType": "Hotels",
            "geography": "India",
            "category": "5-star",
            "extras": {"sourcesDeferred": "true"},
        },
        [],
        catalog=mini_catalog(),
    )
    assert catalog_q and catalog_q["field"] == "attributes"
    assert "Nightly Price" in catalog_q["choices"] or "Amenities" in catalog_q["choices"]
    assert "Company details" not in catalog_q["choices"]


def test_edit_scope_asks_what_to_change():
    from engine import _handle_revise

    state = {
        "phase": "confirming",
        "buildNew": True,
        "requirement": {
            "entityType": "Hotels",
            "geography": "India",
            "attributes": ["Pricing"],
            "frequency": "Daily",
            "sources": [],
            "sourceUrls": [],
            "extras": {},
        },
        "family": "hospitality",
        "answersLog": [],
        "askedFields": ["category", "frequency"],
        "pendingField": None,
    }
    out = _handle_revise("", state, "revise", None)
    assert out["state"]["phase"] == "revising"
    assert out["state"]["pendingField"] == "__edit_target"
    assert "What would you like to change" in (out.get("text") or "")
    choices = " ".join(out["cards"][1]["choices"])
    assert "Frequency" in choices
    picked = _handle_revise("Frequency (currently Daily)", out["state"], "answer_question", None)
    assert picked["state"]["pendingField"] == "frequency"
    assert picked["state"]["phase"] == "revising"
    done = _handle_revise("Hourly", picked["state"], "answer_question", None)
    assert done["state"]["phase"] == "confirming"
    assert done["state"]["requirement"]["frequency"] == "Hourly"
    options = [opt["id"] for card in done["cards"] for opt in (card.get("options") or [])]
    assert "revise" in options
    assert "submit_job" in options


def test_edit_scope_field_question_uses_llm():
    from unittest.mock import patch

    import engine

    captured: dict = {}

    def fake(payload):
        captured.update(payload)
        return {
            "field": "attributes",
            "prompt": "Which flight details do you need?",
            "choices": [
                "Property",
                "Chain",
                "Stars",
                "Flight number & airline",
                "Origin & destination",
                "Fare class & price",
                "All available fields",
            ],
            "multi": True,
            "allowOther": True,
        }, "openai"

    state = {
        "phase": "revising",
        "buildNew": True,
        "requirement": {
            "entityType": "Flights",
            "geography": "India",
            "attributes": ["Pricing"],
            "sources": [],
            "sourceUrls": [],
            "extras": {},
        },
        "family": "travel",
        "answersLog": [],
        "pendingField": "__edit_target",
        "solutionHits": [
            {
                "name": "Travel & Hospitality",
                "attributes": ["Property", "Chain", "Stars", "Address", "Latitude"],
            }
        ],
    }
    with patch.object(engine, "compose_scope_question", fake):
        out = engine._handle_revise("Required data (currently Pricing)", state, "answer_question", None)
    assert captured.get("editing") is True
    assert captured.get("field") == "attributes"
    assert out["llm"]["used"] is True
    assert out["text"] == "Which flight details do you need?"
    choices = out["cards"][0]["choices"]
    assert "Pricing" in choices
    assert "Flight number & airline" in choices
    assert "Property" not in choices
    assert "Chain" not in choices


def test_flight_required_data_is_not_hotel_fields():
    from questions import synthesize_question

    req = extract_requirement("airlines in India with pricing")
    catalog = mini_catalog()
    travel = next(sol for sol in catalog["solutions"] if sol["id"] == "ds-travel")
    travel["attributes"] = [
        "Property",
        "Chain",
        "Stars",
        "Address",
        "City",
        "Country",
        "Latitude",
        "Longitude",
        "Amenities",
        "Room Type",
        "Nightly Price",
    ]
    question = synthesize_question(
        "attributes",
        req,
        "travel",
        catalog=catalog,
        solution_hits=[travel],
    )
    choices = question["choices"]
    assert "flight" in question["prompt"].lower()
    assert "Pricing" in (question.get("selected") or [])
    for hotel_field in ("Property", "Chain", "Stars", "Address", "Latitude", "Longitude", "Room Type", "Nightly Price"):
        assert hotel_field not in choices
    for flight_field in ("Flight number", "Airline", "Origin", "Destination", "Fare class"):
        assert flight_field in choices
    assert choices[-1] == "All available fields"


def test_edit_attributes_keeps_query_pricing():
    from questions import apply_answer, synthesize_question

    req = extract_requirement("Show me hotels with pricing in India")
    catalog = mini_catalog()
    hits = [sol for sol in catalog["solutions"] if "Hotel" in sol["name"]]
    question = synthesize_question("attributes", req, "hospitality", catalog=catalog, solution_hits=hits)
    assert "Pricing" in question["choices"]
    assert "Pricing" in (question.get("selected") or [])
    # Catalog options without Pricing must not wipe the query attribute.
    updated = apply_answer(req, "attributes", "Amenities; Reviews", ["Nightly Price", "Amenities", "Star Rating", "Reviews"])
    assert "Pricing" in updated["attributes"]
    assert "Amenities" in updated["attributes"]
    assert "Reviews" in updated["attributes"]
    # Explicitly leaving Pricing selected plus extras keeps it.
    kept = apply_answer(req, "attributes", "Pricing; Amenities", ["Pricing", "Amenities", "Reviews"])
    assert kept["attributes"] == ["Pricing", "Amenities"]


def test_specific_websites_asks_for_names():
    from engine import _handle_revise

    req = apply_answer(
        {
            "entityType": "Hotels",
            "geography": "India",
            "attributes": ["Pricing"],
            "category": "5-star",
            "frequency": "Daily",
            "sources": [],
            "sourceUrls": [],
            "extras": {},
        },
        "sources",
        "Specific websites",
        ["Specific websites", "Official sources only", "Suitable public sources", "No preference"],
    )
    assert req["sources"] == []
    assert req["extras"].get("needSourceNames") == "true"
    q = next_question("hospitality", req, ["sources"])
    assert q and q["field"] == "sourceNames"
    named = apply_answer(req, "sourceNames", "Booking.com; MakeMyTrip")
    assert named["sources"] == ["Booking.com", "MakeMyTrip"]
    assert named["extras"].get("needSourceNames") != "true"

    state = {
        "phase": "revising",
        "buildNew": True,
        "requirement": {
            "entityType": "Hotels",
            "geography": "India",
            "attributes": ["Pricing"],
            "frequency": "Daily",
            "sources": [],
            "sourceUrls": [],
            "extras": {},
        },
        "family": "hospitality",
        "answersLog": [],
        "pendingField": "sources",
        "pendingChoices": ["Specific websites", "Official sources only", "Suitable public sources", "No preference"],
        "solutionHits": [{"name": "Hotels, Restaurants & Venues", "sourceNames": ["MakeMyTrip", "Booking.com"]}],
    }
    follow = _handle_revise("Specific websites", state, "answer_question", mini_catalog())
    assert follow["state"]["pendingField"] == "sourceNames"
    assert follow["state"]["phase"] == "revising"
    done = _handle_revise("Goibibo; https://www.makemytrip.com", follow["state"], "answer_question", mini_catalog())
    assert done["state"]["phase"] == "confirming"
    assert "Goibibo" in done["state"]["requirement"]["sources"]
    assert "https://www.makemytrip.com" in done["state"]["requirement"]["sourceUrls"]


def test_airlines_matches_travel_not_funding():
    text = "Airlines pricing data in India"
    req = extract_requirement(text)
    assert req["entityType"] == "Flights"
    assert req["geography"] == "India"
    assert "Pricing" in req["attributes"]
    matched = match_capabilities(text, req, mini_catalog())
    names = [s["name"] for s in matched["solutions"]]
    assert "Travel & Hospitality" in names
    assert "Funding & Investment" not in names
    assert matched["kind"] in {"existing", "partial"}


def test_school_districts_matches_workforce_not_funding():
    text = "US School districts teachers data"
    req = extract_requirement(text)
    assert req["entityType"] == "School districts"
    assert req["geography"] == "US"
    matched = match_capabilities(text, req, mini_catalog())
    names = [s["name"] for s in matched["solutions"]]
    assert "US Public School District Workforce" in names
    assert "Funding & Investment" not in names
    assert matched["kind"] in {"existing", "partial"}


def test_semantic_paraphrase_does_not_need_keywords():
    text = "Airfare for domestic carriers"
    req = extract_requirement(text)
    matched = match_capabilities(
        text,
        req,
        mini_catalog(),
        semantic_scores={"ds-travel": 0.82, "ds-funding": 0.11, "ds-hospitality-venues": 0.40},
    )
    names = [s["name"] for s in matched["solutions"]]
    assert "Travel & Hospitality" in names
    assert "Funding & Investment" not in names
    assert matched["kind"] in {"existing", "partial"}


def test_hospital_query_matches_healthcare():
    text = "I need hospital information in India with doctors, specialties and services"
    req = extract_requirement(text)
    assert req["entityType"] == "Hospitals"
    assert req["geography"] == "India"
    assert "Doctors" in req["attributes"]
    matched = match_capabilities(text, req, mini_catalog())
    names = [s["name"] for s in matched["solutions"]]
    assert "Hospitals, Clinics & Doctors" in names
    assert matched["kind"] in {"existing", "partial"}
    assert "Hotels, Restaurants & Venues" not in names


def test_firmographic_list_questions_are_split():
    req = extract_requirement("List of Tech companies in India with Address and phone number")
    req = apply_answer(req, "subIndustry", "SaaS")
    asked = ["subIndustry"]
    company_type = next_question("firmographic", req, asked)
    assert company_type and company_type["field"] == "extras.companyType"
    assert company_type["choices"] == ["Public", "Private", "Startup", "All companies"]
    assert "Filter by employee count" not in company_type["choices"]
    req = apply_answer(req, "extras.companyType", "Private; Startup")
    asked.append("extras.companyType")
    size = next_question("firmographic", req, asked)
    assert size and size["field"] == "extras.sizeFilter"
    assert size["choices"] == [
        "Filter by employee count",
        "Filter by annual revenue range",
        "No size filter",
    ]
    assert "Public" not in size["choices"]
    req = apply_answer(req, "extras.sizeFilter", "Filter by employee count")
    asked.append("extras.sizeFilter")
    limit = next_question("firmographic", req, asked)
    assert limit and limit["field"] == "extras.listSize"
    assert "Top 50" in limit["choices"]
    assert "Top 100" in limit["choices"]
    req = apply_answer(req, "extras.listSize", "Top 100")
    assert req["extras"]["volume"] == "Top 100"
    asked.append("extras.listSize")
    sources = next_question("firmographic", req, asked)
    assert sources and sources["field"] == "sources"
    assert sources["choices"] == [
        "I'll upload a list",
        "Ask the Freda team to generate a list",
        "Get the list from Wikipedia or a third party",
    ]
    assert "LinkedIn" not in " ".join(sources["choices"])
    saved = apply_answer(req, "sources", "Ask the Freda team to generate a list", sources["choices"])
    assert saved["sources"] == []
    assert saved["extras"]["sourceMode"] == "freda"


def test_show_me_is_not_create():
    assert classify_intent("Show me hotels with pricing in India") == "find_existing"
    assert classify_intent("I need a daily dataset of 5-star hotels in India with pricing") == "create_dataset"


if __name__ == "__main__":
    tests = [
        test_tech_companies_extraction,
        test_tech_companies_matches_firmographic,
        test_hotels_extraction_and_match,
        test_hotels_questions_skip_known,
        test_all_available_fields_not_exploded,
        test_annual_reports_sources_preserved,
        test_questions_are_generated_for_entity_not_a_bank,
        test_edit_scope_asks_what_to_change,
        test_edit_scope_field_question_uses_llm,
        test_flight_required_data_is_not_hotel_fields,
        test_edit_attributes_keeps_query_pricing,
        test_specific_websites_asks_for_names,
        test_airlines_matches_travel_not_funding,
        test_school_districts_matches_workforce_not_funding,
        test_semantic_paraphrase_does_not_need_keywords,
        test_hospital_query_matches_healthcare,
        test_firmographic_list_questions_are_split,
        test_show_me_is_not_create,
    ]
    failed = 0
    for test in tests:
        try:
            test()
            print(f"OK  {test.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {test.__name__}: {exc}")
    if failed:
        raise SystemExit(1)
    print("All enhancement checks passed.")
