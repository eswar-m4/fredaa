"""
Configuration management for F.R.E.D.A

This module handles all configuration settings using environment variables
and Pydantic for validation. Follows 12-factor app methodology.
"""

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
    API_RELOAD: bool = True  # Set to False in production
    
    # Logging settings
    LOG_LEVEL: str = "INFO"
    
    # Upload settings
    MAX_UPLOAD_SIZE_MB: int = 100  # 100MB default limit

    # Persistence
    FREDA_DB_PATH: str = "data/freda.db"

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
        "business_directory",
        "user_defined",
    ]
    
    # AI/LLM settings (Phase 3) - Using Google Gemini Flash
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-1.5-flash"
    GROQ_API_KEY: Optional[str] = None
    GROQ_API_BASE: str = "https://api.groq.ai/v1"
    GROQ_MODEL: str = "llama3-70b-8192"
    # OpenAI fallback (used when GROQ not configured or explicitly preferred)
    OPENAI_API_KEY: Optional[str] = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    AI_REQUEST_TIMEOUT_SEC: int = 30

    # Ollama local LLM settings (website complexity classification + workflow recommendations)
    OLLAMA_BASE_URL: str = "http://127.0.0.1:11434"
    OLLAMA_MODEL: str = "qwen3:0.6b"
    WEBSITE_COMPLEXITY_XLSX_PATH: str = "data/Website Complexity.xlsx"
    
    class Config:
        """Pydantic config class"""
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


# Global settings instance
settings = Settings()
