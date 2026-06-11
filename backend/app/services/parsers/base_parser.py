"""
Base parser definition for F.R.E.D.A parsers.
"""

from abc import ABC, abstractmethod
from io import BytesIO
from typing import Any, Dict


class BaseParser(ABC):
    """
    Abstract base class for file parsers.
    """

    @abstractmethod
    def parse(self, file_stream: BytesIO) -> Dict[str, Any]:
        """Parse file bytes and return extraction metadata."""
        raise NotImplementedError
