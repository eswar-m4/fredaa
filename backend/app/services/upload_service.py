"""
Upload service for F.R.E.D.A

This module handles file upload logic. In Phase 1, it's a skeleton that:
- Validates file metadata
- Generates unique upload IDs
- Tracks upload status

Later phases will add:
- File parsing (Phase 2)
- OCR processing (Phase 2)
- Schema inference (Phase 3)
"""

import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class UploadService:
    """
    Service for handling file uploads and metadata tracking.
    
    This is a Phase 1 skeleton that will be extended in future phases
    with parsing, OCR, and data processing capabilities.
    """
    
    def __init__(self):
        """Initialize upload service"""
        # In-memory storage for Phase 1 (will use database in production)
        self.uploads = {}
        self._upload_root = Path(__file__).resolve().parents[2] / "data" / "uploads"
        self._upload_root.mkdir(parents=True, exist_ok=True)
        logger.info("UploadService initialized")
    
    def validate_file_metadata(
        self,
        filename: str,
        file_size: int,
        max_size_mb: int
    ) -> tuple[bool, Optional[str]]:
        """
        Validate file metadata before processing.
        
        Args:
            filename: Name of uploaded file
            file_size: Size of file in bytes
            max_size_mb: Maximum allowed file size in MB
            
        Returns:
            Tuple of (is_valid: bool, error_message: Optional[str])
        """
        # Check file size
        max_size_bytes = max_size_mb * 1024 * 1024
        if file_size > max_size_bytes:
            error_msg = f"File size {file_size} bytes exceeds maximum {max_size_bytes} bytes"
            logger.warning(error_msg)
            return False, error_msg
        
        # Check filename is not empty
        if not filename or len(filename.strip()) == 0:
            error_msg = "Filename cannot be empty"
            logger.warning(error_msg)
            return False, error_msg
        
        logger.info(f"File metadata validation passed: {filename} ({file_size} bytes)")
        return True, None
    
    def detect_file_format(self, filename: str) -> str:
        """
        Detect file format from filename extension.
        
        Args:
            filename: Name of file
            
        Returns:
            File format (extension without dot)
        """
        if not filename or "." not in filename:
            return "unknown"
        
        # Get extension and convert to lowercase
        extension = filename.rsplit(".", 1)[-1].lower()
        logger.debug(f"Detected format for {filename}: {extension}")
        return extension
    
    def create_upload_record(
        self,
        filename: str,
        file_size: int,
        format: str
    ) -> dict:
        """
        Create and store an upload record.
        
        Args:
            filename: Name of uploaded file
            file_size: Size of file in bytes
            format: File format
            
        Returns:
            Dictionary containing upload metadata
        """
        # Generate unique upload ID
        upload_id = f"upload_{uuid.uuid4().hex[:12]}"
        
        # Create record
        upload_record = {
            "id": upload_id,
            "filename": filename,
            "file_size": file_size,
            "format": format,
            "status": "pending",
            "created_at": datetime.utcnow().isoformat(),
            "metadata": {}
        }
        
        # Store record (in-memory for Phase 1)
        self.uploads[upload_id] = upload_record

        logger.info(f"Created upload record: {upload_id} for file {filename}")
        return upload_record

    def persist_upload_file(self, upload_id: str, filename: str, content: bytes) -> str:
        """
        Persist uploaded file bytes to durable storage.

        Args:
            upload_id: Upload identifier.
            filename: Original uploaded filename.
            content: Raw file bytes.

        Returns:
            Absolute storage path for the persisted file.
        """
        safe_name = Path(filename or "upload.bin").name
        target_dir = self._upload_root / upload_id
        target_dir.mkdir(parents=True, exist_ok=True)
        storage_path = target_dir / safe_name
        storage_path.write_bytes(content)
        if upload_id in self.uploads:
            self.uploads[upload_id]["storage_path"] = str(storage_path)
        logger.info("Persisted upload %s to %s", upload_id, storage_path)
        return str(storage_path)
    
    def get_upload_record(self, upload_id: str) -> Optional[dict]:
        """
        Retrieve an upload record by ID.
        
        Args:
            upload_id: Upload identifier
            
        Returns:
            Upload record dictionary or None if not found
        """
        record = self.uploads.get(upload_id)
        if record:
            logger.debug(f"Retrieved upload record: {upload_id}")
        else:
            logger.warning(f"Upload record not found: {upload_id}")
        return record
    
    def attach_parse_summary(self, upload_id: str, summary: dict) -> bool:
        """
        Attach parsing metadata to an upload record.
        
        Args:
            upload_id: Upload identifier
            summary: Parsed summary metadata
            
        Returns:
            True if metadata attached, False if record not found
        """
        if upload_id in self.uploads:
            self.uploads[upload_id]["metadata"] = summary
            logger.info(f"Attached parse summary to upload {upload_id}")
            return True

        logger.warning(f"Cannot attach parse summary: upload record not found {upload_id}")
        return False

    def update_upload_status(self, upload_id: str, status: str) -> bool:
        """
        Update upload status (for future use in processing pipeline).
        
        Args:
            upload_id: Upload identifier
            status: New status value
            
        Returns:
            True if updated, False if record not found
        """
        if upload_id in self.uploads:
            self.uploads[upload_id]["status"] = status
            logger.info(f"Updated upload {upload_id} status to: {status}")
            return True
        
        logger.warning(f"Cannot update status: upload record not found {upload_id}")
        return False


# Global upload service instance
upload_service = UploadService()
