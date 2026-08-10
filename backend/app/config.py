"""
Configuration management for F.R.E.D.A

This module handles all configuration settings using environment variables
and Pydantic for validation. Follows 12-factor app methodology.
"""

from pathlib import Path

from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    
    Attributes:
        APP_NAME: Application name
        APP_VERSION: Application version
        LOG_LEVEL: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        API_HOST: Host to bind FastAPI server to
        API_PORT: Port to bind FastAPI server to
        API_RELOAD: Enable auto-reload on file changes (dev only)
        MAX_UPLOAD_SIZE_MB: Maximum file upload size in megabytes
    """
    
    # Application settings
    APP_NAME: str = "F.R.E.D.A"
    APP_VERSION: str = "0.1.0"
    
    # Server settings
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    # Keep auto-reload off by default so long-running bot jobs are not killed
    # by file-change restarts during onboarding/execution.
    API_RELOAD: bool = False
    
    # Logging settings
    LOG_LEVEL: str = "INFO"
    
    # Upload settings
    MAX_UPLOAD_SIZE_MB: int = 100  # 100MB default limit

    # Persistence
    FREDA_DB_PATH: str = "../data/freda.db"
    # Override in .env with a long random string; the default is public and must
    # not be used in production (changing it invalidates all existing sessions).
    FREDA_AUTH_SALT: str = "freda-auth-salt"
    FREDA_SESSION_TTL_HOURS: int = 72
    # Initial seeded account passwords — set in .env before first run.
    # If absent, no default accounts are created and users must be added manually.
    FREDA_DEFAULT_USER_PASS: Optional[str] = None
    FREDA_DEFAULT_ADMIN_PASS: Optional[str] = None

    # Partial scrape runtime controls
    PARTIAL_SCRAPE_MAX_RESULTS: int = 50
    BOT_RUNTIME_TIMEOUT_SEC: int = 1800
    BOT_RUNTIME_TIMEOUT_OVERRIDES_JSON: str = '{"bot_J-8356": 5400}'

    # Workflow thresholds (defaults; overridable per request config)
    WORKFLOW_AUTO_APPROVE_THRESHOLD: int = 75
    WORKFLOW_REVIEW_THRESHOLD: int = 60
    WORKFLOW_MIN_CANDIDATE_GAP: int = 15
    WORKFLOW_AMBIGUITY_SCORE_GAP: int = 5
    
    # Supported file formats for Phase 1 (only definition, not used yet)
    SUPPORTED_FORMATS: list = ["csv", "xlsx", "pdf", "txt", "docx"]

    # Source discovery priorities for Phase 9
    SOURCE_DISCOVERY_PRIORITIES: list[str] = [
        "linkedin",
        "company_website",
        "government_registry",
        "gleif",
        "companies_house",
        "wikidata",
        "business_directory",
        "user_defined",
    ]

    # AI/LLM settings
    LOVABLE_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-1.5-flash"
    GROQ_API_KEY: Optional[str] = None
    GROQ_API_BASE: str = "https://api.groq.com/openai/v1"
    GROQ_MODEL: str = "llama3-70b-8192"
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    AI_REQUEST_TIMEOUT_SEC: int = 30

    # Ollama local LLM settings (website complexity classification + workflow recommendations)
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "qwen3:0.6b"
    WEBSITE_COMPLEXITY_XLSX_PATH: str = "data/Website Complexity.xlsx"
    
    class Config:
        """Pydantic config class"""
        env_file = str(Path(__file__).resolve().parents[1] / ".env")
        env_file_encoding = "utf-8"
        case_sensitive = True


def _load_settings() -> Settings:
    """
    Load settings, giving .env file values priority over system environment
    variables for API keys. This prevents stale system-level env vars from
    overriding the keys configured in .env.
    """
    import os

    env_file = Path(__file__).resolve().parents[1] / ".env"
    env_overrides: dict = {}

    if env_file.exists():
        with open(env_file, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                # Only override API key fields — don't mess with anything else
                if key in (
                    "OPENAI_API_KEY",
                    "GEMINI_API_KEY",
                    "GROQ_API_KEY",
                    "LOVABLE_API_KEY",
                ):
                    env_overrides[key] = value

    # Temporarily set the .env values in the process environment so
    # Pydantic picks them up (they override the system env var for this process)
    original: dict = {}
    for key, value in env_overrides.items():
        original[key] = os.environ.get(key)
        os.environ[key] = value

    instance = Settings()

    # Restore originals (don't permanently alter the process environment)
    for key, orig_value in original.items():
        if orig_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = orig_value

    return instance


# Global settings instance — .env API keys take priority over system env vars
settings = _load_settings()
