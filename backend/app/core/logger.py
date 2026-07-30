"""
Logging configuration module for F.R.E.D.A

This module sets up structured logging for the application using Python's
standard logging library, configured for production use.
"""

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logger(name: str, log_level: str = "INFO") -> logging.Logger:
    """
    Configure and return a logger instance.
    
    Args:
        name: Logger name (typically __name__ of calling module)
        log_level: Logging level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    logger.setLevel(getattr(logging, log_level))
    
    # Only add handlers if not already configured
    if not logger.handlers:
        # Console handler - logs to stdout
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(getattr(logging, log_level))
        
        # Formatter - consistent format across all logs
        formatter = logging.Formatter(
            fmt='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
            datefmt='%Y-%m-%d %H:%M:%S'
        )
        console_handler.setFormatter(formatter)
        logger.addHandler(console_handler)
        
        # File handler - keep runtime logs under the backend tree.
        log_dir = Path(__file__).resolve().parents[2] / "logs"
        log_dir.mkdir(exist_ok=True)

        file_handler = RotatingFileHandler(
            filename=log_dir / "freda_runtime.log",
            maxBytes=10_485_760,  # 10MB
            backupCount=5  # Keep 5 backup files
        )
        file_handler.setLevel(getattr(logging, log_level))
        file_handler.setFormatter(formatter)
        logger.addHandler(file_handler)
    
    return logger


# Global logger instance
logger = setup_logger(__name__)
