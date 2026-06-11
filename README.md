# F.R.E.D.A - Fresh Data Engine & Resolution Architecture

## Overview

F.R.E.D.A is a production-grade AI-powered multimodal data processing system. The current implementation focuses on **Phase 3: AI Input Understanding Layer** - building intelligent analysis of any type of input using Google Gemini Flash via a provider-agnostic abstraction layer.

> Example inputs in docs use generic company and entity examples to illustrate behavior, while the runtime provider is Gemini Flash.

### Current Phase
**Phase 3: AI Input Understanding** (ACTIVE)
- FastAPI project structure
- Modular architecture
- File parsing (CSV, XLSX, PDF, DOCX, TXT)
- Gemini Flash-powered input analysis
- Unified output schema
- Configuration management
- Logging setup

### Tech Stack
- **Framework**: FastAPI
- **Language**: Python 3.8+
- **Libraries**: pandas, openpyxl, pdfplumber, pymupdf, python-docx, pytesseract, rapidfuzz
- **AI Provider**: Google Gemini Flash via `google-generativeai`
- **Provider Abstraction**: `app.services.ai_provider.AIProvider`

---

## Project Structure

```
freda-backend/
├── app/                          # Main application package
│   ├── __init__.py              # Package initialization
│   ├── main.py                  # FastAPI app entry point
│   ├── config.py                # Configuration management
│   │
│   ├── core/                    # Core utilities
│   │   ├── __init__.py
│   │   └── logger.py            # Structured logging setup
│   │
│   ├── api/                     # API routes and endpoints
│   │   ├── __init__.py
│   │   └── routes.py            # FastAPI route definitions
│   │
│   ├── models/                  # Data models and schemas
│   │   ├── __init__.py
│   │   ├── schemas.py           # Pydantic request/response schemas
│   │   └── parsed_schemas.py    # Parsed file metadata schemas
│   │
│   └── services/                # Business logic layer
│       ├── __init__.py
│       ├── upload_service.py    # File upload metadata tracking
│       ├── parser_service.py    # File parsing orchestration
│       └── parsers/            # Modular parser implementations
│           ├── __init__.py
│           ├── base_parser.py
│           ├── csv_parser.py
│           ├── xlsx_parser.py
│           ├── pdf_parser.py
│           ├── docx_parser.py
│           └── txt_parser.py
│
├── tests/                        # Unit tests for parser components
│   └── test_parser_service.py
├── requirements.txt             # Python dependencies
├── .env.example                 # Environment configuration template
└── README.md                    # This file
```

### Folder Structure Explanation

- **app/**: Core application package. All code lives here.
- **core/**: Shared utilities (logging, errors, constants)
- **api/**: HTTP endpoint definitions. Routes requests to services.
- **models/**: Pydantic schemas for request/response validation
- **services/**: Business logic. Handles file processing, validation, etc.

---

## Setup Instructions

### 1. Virtual Environment
```bash
# Navigate to project root
cd freda-backend

# Create virtual environment (if not already done)
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Environment Configuration
```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your settings (optional for Phase 1)
```

### 4. Run Application
```bash
# Development server (with auto-reload)
python -m app.main

# Or use uvicorn directly
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at: `http://localhost:8000`

---

## API Endpoints

### Health Check
```
GET /api/v1/health
```
Verify service is running.

**Response:**
```json
{
  "status": "healthy",
  "version": "0.3.0",
  "timestamp": "2024-01-15T10:30:00",
  "message": "F.R.E.D.A backend is operational"
}
```

### File Upload (Phase 2)
```
POST /api/v1/upload
```
Upload files for processing with parser.

**Request:**
- Content-Type: multipart/form-data
- Parameter: `file` (binary)

**Response:**
```json
{
  "id": "upload_a1b2c3d4e5f6",
  "filename": "data.csv",
  "file_size": 15360,
  "format": "csv",
  "status": "processed",
  "timestamp": "2024-01-15T10:30:00",
  "message": "File uploaded and parsed successfully.",
  "parsed_summary": {
    "format": "csv",
    "row_count": 100,
    "column_count": 5,
    "columns": ["id", "name", "email", "company", "date"]
  }
}
```

### Process Text Input (Phase 3)
```
POST /api/v1/process-input
Content-Type: application/json
```
Analyze raw text with AI understanding.

**Request:**
```json
{
  "text": "Acme Corporation is a leading technology provider"
}
```

**Response:**
```json
{
  "input_type": "text",
  "entity_type": "company",
  "raw_input": "Acme Corporation is a leading technology provider",
  "content": "Acme Corporation is a leading technology provider",
  "normalized_data": {"name": "Acme Corporation"},
  "summary": "Recognized as company Acme Corporation.",
  "confidence_score": 0.95,
  "attributes": {
    "name": "Acme Corporation",
    "industry": "technology",
    "type": "organization"
  },
  "metadata": {"ai_model": "gemini-1.5-flash"},
  "processing_time_ms": 450,
  "timestamp": "2024-01-15T10:30:00"
}
```

---

## Documentation

### API Documentation
Access interactive API documentation:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Code Files Explanation

#### main.py
- FastAPI application initialization
- CORS middleware configuration
- Global exception handling
- Startup/shutdown events
- Route registration

#### config.py
- Environment variable management using Pydantic
- Type-safe configuration with validation
- Follows 12-factor app methodology

#### core/logger.py
- Structured logging setup
- Console and file handlers
- Rotating file handler (10MB limit, 5 backups)
- Production-ready log formatting

#### models/schemas.py
- Pydantic models for request/response validation
- Auto-generates OpenAPI documentation
- Type hints and field descriptions

#### services/upload_service.py
- File metadata validation
- File format detection
- Upload record management
- Ready for Phase 2 file parsing

#### api/routes.py
- FastAPI route definitions
- Request/response handling
- Error handling and validation

---

## Configuration

Environment variables can be set in `.env` file:

```env
APP_NAME=F.R.E.D.A
APP_VERSION=0.1.0
API_HOST=0.0.0.0
API_PORT=8000
API_RELOAD=True
LOG_LEVEL=INFO
MAX_UPLOAD_SIZE_MB=100
```

---

## Testing (Phase 1)

### Health Check
```bash
curl http://localhost:8000/api/v1/health
```

### File Upload
```bash
# Linux/macOS
curl -X POST -F "file=@test_file.csv" http://localhost:8000/api/v1/upload

# Windows PowerShell
$file = Get-Item "test_file.csv"
$uri = "http://localhost:8000/api/v1/upload"
$form = @{ file = $file }
Invoke-WebRequest -Uri $uri -Method Post -Form $form
```

---

## Development Notes

### Phase 1 (Current)
✅ Backend foundation established
✅ Modular architecture
✅ Configuration management
✅ Health check endpoint
✅ File upload skeleton
✅ Logging infrastructure

### Future Phases
Phase 2: File Parsing Engine (CSV, XLSX, PDF, DOCX)
Phase 3: Schema Inference
Phase 4: Data Normalization
Phase 5: Record Matching & Enrichment
Phase 6: UI/Dashboard

---

## Logging

Logs are written to both console and file:
- **Console**: Real-time visibility during development
- **File**: `logs/freda.log` with automatic rotation

Log level can be controlled via `LOG_LEVEL` environment variable.

---

## Author
F.R.E.D.A Team

## Version
0.1.0 (Phase 1)
