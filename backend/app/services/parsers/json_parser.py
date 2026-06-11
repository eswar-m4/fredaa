"""
JSON parser implementation for F.R.E.D.A.
"""

import json
from io import BytesIO
from typing import Any, Dict, List

from app.core.logger import setup_logger
from app.services.parsers.base_parser import BaseParser

logger = setup_logger(__name__)


class JSONParser(BaseParser):
    """Parser for JSON files containing an object or an array of objects."""

    def parse(self, file_stream: BytesIO) -> Dict[str, Any]:
        file_stream.seek(0)
        payload = json.loads(file_stream.read().decode("utf-8-sig"))
        records = self._records_from_payload(payload)
        columns = self._columns_from_records(records)

        logger.info("JSON file parsed successfully")
        return {
            "format": "json",
            "row_count": len(records),
            "column_count": len(columns),
            "columns": columns,
            "sample": records[:3],
            "records": records,
            "text_preview": json.dumps(payload, ensure_ascii=False)[:2000],
        }

    def _records_from_payload(self, payload: Any) -> List[Dict[str, Any]]:
        if isinstance(payload, list):
            return [
                item if isinstance(item, dict) else {"value": item}
                for item in payload
            ]
        if isinstance(payload, dict):
            for value in payload.values():
                if isinstance(value, list):
                    return [
                        item if isinstance(item, dict) else {"value": item}
                        for item in value
                    ]
            return [payload]
        return [{"value": payload}]

    def _columns_from_records(self, records: List[Dict[str, Any]]) -> List[str]:
        columns = []
        for record in records:
            for key in record.keys():
                if key not in columns:
                    columns.append(key)
        return columns
