"""
CSV parser implementation for F.R.E.D.A.
"""

from io import BytesIO
from typing import Dict, Any

import pandas as pd
from app.services.parsers.base_parser import BaseParser
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class CSVParser(BaseParser):
    """Parser for CSV files."""

    def parse(self, file_stream: BytesIO) -> Dict[str, Any]:
        file_stream.seek(0)

        # Use pandas to read CSV from bytes
        df = pd.read_csv(file_stream, dtype=str)
        row_count = int(df.shape[0])
        column_count = int(df.shape[1])
        columns = df.columns.tolist()
        records = df.fillna("").to_dict(orient="records")
        sample = records[:3]

        logger.info("CSV file parsed successfully")
        return {
            "format": "csv",
            "row_count": row_count,
            "column_count": column_count,
            "columns": columns,
            "sample": sample,
            "records": records,
        }
