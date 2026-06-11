"""
FastAPI application entry point for F.R.E.D.A

This module creates and configures the FastAPI application instance with
all middleware, routes, and exception handlers.
"""

import sys
import os
# Add backend directory to sys.path to allow top-level app imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from datetime import datetime
from pathlib import Path

from app.config import settings
from app.api import routes
from app.api import demo_routes
from app.api import source_analysis_routes
from app.core.database import init_db
from app.core.logger import setup_logger

# Initialize logger
logger = setup_logger(__name__, settings.LOG_LEVEL)

# Create FastAPI application
app = FastAPI(
    title=settings.APP_NAME,
    description="Fresh Data Engine & Resolution Architecture - Multimodal Input Engine",
    version=settings.APP_VERSION,
    docs_url="/docs",  # Swagger UI
    redoc_url="/redoc"  # ReDoc
)

# Configure CORS middleware
# In production, restrict origins to specific domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1",
        "http://localhost",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:8001",
        "http://localhost:8001",
        "http://localhost:8080",
        "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve optional frontend integration assets if present
app.mount("/static", StaticFiles(directory=str(Path(__file__).parent.parent.parent / "frontend")), name="static")


# Serve index.html at root
@app.get("/")
async def root():
    """Serve the frontend dashboard."""
    frontend_path = Path(__file__).parent.parent.parent / "frontend" / "index.html"
    if frontend_path.exists():
        return FileResponse(frontend_path)
    return {"message": "F.R.E.D.A API is running. Visit /api/v1/docs for API documentation."}


# Global exception handler for unexpected errors
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """
    Global exception handler for unhandled errors.
    
    Args:
        request: FastAPI Request object
        exc: The exception that was raised
        
    Returns:
        JSON error response with 500 status
    """
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)
    
    return JSONResponse(
        status_code=500,
        content={
            "error": "INTERNAL_SERVER_ERROR",
            "message": "An unexpected error occurred",
            "timestamp": datetime.utcnow().isoformat()
        }
    )


# Include API routes
app.include_router(routes.router, prefix="/api/v1", tags=["API"])
app.include_router(demo_routes.router, prefix="/api/v1/demo", tags=["Demo"])
app.include_router(source_analysis_routes.router, prefix="/api/v1/source-analysis", tags=["Source Analysis"])


async def refresh_scheduler_loop():
    import asyncio
    from datetime import datetime
    from app.core.database import get_connection
    from app.api.demo_routes import run_scraper_background
    
    logger.info("Scheduler: refresh_scheduler_loop started.")
    while True:
        try:
            await asyncio.sleep(10)  # check every 10 seconds
            now_str = datetime.utcnow().isoformat() + "Z"
            
            with get_connection() as conn:
                due_jobs = conn.execute(
                    "SELECT id, source FROM scraper_jobs WHERE status = 'Completed' AND next_refresh IS NOT NULL AND next_refresh <= ?",
                    (now_str,)
                ).fetchall()
                
            for row in due_jobs:
                job_id = row[0]
                source = row[1]
                logger.info(f"Scheduler: triggering refresh for job {job_id} ({source})...")
                
                # Update status to 'Running' so it doesn't get picked up again
                with get_connection() as conn:
                    conn.execute("UPDATE scraper_jobs SET status = 'Running' WHERE id = ?", (job_id,))
                    conn.commit()
                
                # Start background task
                asyncio.create_task(run_scraper_background(job_id))
        except Exception as e:
            logger.error(f"Error in refresh scheduler loop: {e}", exc_info=True)


# Startup event
@app.on_event("startup")
async def startup_event():
    """
    Run on application startup.
    Perform initialization tasks like database connection, cache setup, etc.
    """
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    logger.info(f"Server configured: {settings.API_HOST}:{settings.API_PORT}")
    init_db()
    
    import asyncio
    asyncio.create_task(refresh_scheduler_loop())
    
    logger.info("Application initialization complete")


# Shutdown event
@app.on_event("shutdown")
async def shutdown_event():
    """
    Run on application shutdown.
    Clean up resources like database connections, file handles, etc.
    """
    logger.info(f"Shutting down {settings.APP_NAME}")


if __name__ == "__main__":
    # This is for development only. In production, use a production ASGI server like Uvicorn
    import uvicorn
    
    uvicorn.run(
        "app.main:app",
        host=settings.API_HOST,
        port=settings.API_PORT,
        reload=settings.API_RELOAD,
        log_level=settings.LOG_LEVEL.lower()
    )
