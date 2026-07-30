from __future__ import annotations

import unicodedata


def unidecode(value):
    if value is None:
        return ""
    text = str(value)
    normalized = unicodedata.normalize("NFKD", text)
    return normalized.encode("ascii", "ignore").decode("ascii")


__all__ = ["unidecode"]
