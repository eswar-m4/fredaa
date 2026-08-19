import json
import logging
import re
import requests
from typing import Any, Dict, List, Optional
from app.config import settings

logger = logging.getLogger(__name__)

ALLOWED_SCHEMAS = {
    "Investegate": {
        "fields": [
            "ticker", "cik", "state_of_incorporation", "sic_description",
            "filing_type", "fiscal_year_end", "entity_name"
        ],
        "description": (
            "ticker: String or List of Strings representing uppercase stock ticker symbol (e.g. ['AAPL', 'MSFT'] or 'AAPL').\n"
            "cik: String or List of Strings representing Central Index Key.\n"
            "state_of_incorporation: String or List of Strings representing 2-letter uppercase state code.\n"
            "sic_description: String or List of Strings representing SIC division/industry.\n"
            "filing_type: String or List of Strings representing SEC form type (e.g. ['10-K', '10-Q'] or '10-K').\n"
            "fiscal_year_end: String or List of Strings representing fiscal year end.\n"
            "entity_name: String or List of Strings representing company name."
        )
    }
}


class CustomDumpLLMService:
    """
    Translates natural language user prompts into structured, validated JSON filters
    using a local Qwen LLM instance (Ollama).
    """

    def translate_prompt(self, source: str, prompt: str) -> Dict[str, Any]:
        """
        Sends the user prompt to Qwen, parses the JSON response, validates fields,
        and returns the validated filter dictionary.
        """
        source_key = self._match_source_key(source)
        if not source_key:
            logger.warning(f"Unknown source passed to LLM translation: {source}")
            return {}

        schema_info = ALLOWED_SCHEMAS[source_key]
        fields_desc = schema_info["description"]
        allowed_fields = schema_info["fields"]

        system_prompt = (
            f"You are a database query translator for the F.R.E.D.A platform.\n"
            f"Your task is to convert a user's natural language filter request into a structured JSON filter object for the source: {source_key}.\n\n"
            f"The allowed filter attributes and their specifications for {source_key} are:\n"
            f"{fields_desc}\n\n"
            f"Rules:\n"
            f"1. Output ONLY a valid JSON object. Do not include markdown code block formatting (no ```json or ```).\n"
            f"2. Do NOT write any SQL queries, scraper code, or Python code.\n"
            f"3. Match the user request to the allowed attributes. If a requested filter does not match any allowed attribute, ignore it.\n"
            f"4. Normalize value types to match the schema. A filter value can be a single String or a List of Strings (for multiple categories/options matching any of the items).\n"
            f"5. If the request cannot be translated to any valid filters, return an empty object: {{}}\n\n"
            f"Example output:\n"
            f'{{"category": ["Oscilloscopes", "Probes"], "region": "US / English"}}'
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt}
        ]

        try:
            raw_response = self._ollama_chat(messages)
            extracted = raw_response.get("parsed") or {}
            logger.info(f"LLM Raw Extracted: {extracted}")
            validated = self._normalize_and_validate(source_key, extracted)
            logger.info(f"LLM Validated Filter: {validated}")
            return validated
        except Exception as e:
            logger.error(f"Error during Qwen prompt translation: {e}")
            return {}

    def format_to_query_string(self, validated_filters: Dict[str, Any]) -> str:
        """
        Formats a dictionary of filters into the query format KEY=VALUE1|VALUE2.
        """
        if not validated_filters:
            return "—"
        parts = []
        for k, v in validated_filters.items():
            if isinstance(v, list):
                val_str = "|".join(v)
            else:
                val_str = str(v)
            parts.append(f"{k.upper()}={val_str}")
        return ", ".join(parts)

    def _match_source_key(self, source: str) -> Optional[str]:
        for k in ALLOWED_SCHEMAS.keys():
            if k.lower() == source.lower():
                return k
        return None

    def _ollama_chat(self, messages: List[Dict[str, str]]) -> Dict[str, Any]:
        # Preflight check: verify if local Ollama port is open and responsive (1.5s timeout)
        try:
            requests.get(settings.OLLAMA_BASE_URL, timeout=1.5)
        except Exception as conn_err:
            logger.warning("Ollama pre-flight check failed (offline or unresponsive): %s", conn_err)
            raise ConnectionError(f"Ollama is offline or unresponsive: {conn_err}")

        url = f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat"
        request_payload = {
            "model": settings.OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1},
        }
        response = requests.post(url, json=request_payload, timeout=max(120, settings.AI_REQUEST_TIMEOUT_SEC))
        response.raise_for_status()
        raw = response.json()
        content = (raw.get("message") or {}).get("content") or ""
        parsed = self._extract_json_object(content)
        return {
            "request": request_payload,
            "raw_response": raw,
            "parsed": parsed,
        }

    def _extract_json_object(self, content: str) -> Dict[str, Any]:
        try:
            return json.loads(content)
        except Exception:
            pass
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except Exception:
            return {}

    def _normalize_and_validate(self, source_key: str, extracted_json: Dict[str, Any]) -> Dict[str, Any]:
        schema = ALLOWED_SCHEMAS[source_key]
        allowed_fields = schema["fields"]
        
        validated = {}
        
        for key, val in extracted_json.items():
            if val is None or val == "":
                continue
                
            normalized_key = None
            for af in allowed_fields:
                if af.lower().replace("_", "") == str(key).lower().replace("_", ""):
                    normalized_key = af
                    break
                    
            if not normalized_key:
                continue
                
            if isinstance(val, list):
                clean_list = []
                for item in val:
                    if item is not None and item != "":
                        clean_list.append(str(item).strip())
                if not clean_list:
                    continue
                val_normalized = clean_list
            else:
                val_normalized = str(val).strip()
                
            if source_key == "Webmd":
                if normalized_key in ("Accepting_New_Patients", "Medicare_Accepted", "Medicaid_Accepted"):
                    if isinstance(val_normalized, list):
                        first_val = val_normalized[0].lower() if val_normalized else ""
                    else:
                        first_val = val_normalized.lower()
                    
                    if first_val in ("yes", "true", "1", "y"):
                        val_normalized = "Yes"
                    elif first_val in ("no", "false", "0", "n"):
                        val_normalized = "No"
                    else:
                        continue
                elif normalized_key == "State":
                    if isinstance(val_normalized, list):
                        val_normalized = [s.upper() for s in val_normalized if len(s) == 2]
                        if not val_normalized:
                            continue
                    else:
                        if len(val_normalized) == 2:
                            val_normalized = val_normalized.upper()
                        else:
                            continue
                            
            elif source_key == "Investegate":
                if normalized_key == "ticker":
                    if isinstance(val_normalized, list):
                        val_normalized = [t.upper() for t in val_normalized]
                    else:
                        val_normalized = val_normalized.upper()
                elif normalized_key == "state_of_incorporation":
                    if isinstance(val_normalized, list):
                        val_normalized = [s.upper() for s in val_normalized if len(s) == 2]
                        if not val_normalized:
                            continue
                    else:
                        if len(val_normalized) == 2:
                            val_normalized = val_normalized.upper()
                        else:
                            continue

            if isinstance(val_normalized, list) and len(val_normalized) == 1:
                val_normalized = val_normalized[0]

            validated[normalized_key] = val_normalized
            
        return validated


# Global instance of LLM translation service
custom_dump_llm_service = CustomDumpLLMService()
