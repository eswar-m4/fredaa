"""
AI understanding service for F.R.E.D.A.

This module provides AI-powered analysis and understanding of inputs,
powered by Google's Gemini Flash model (free tier).

Provider-agnostic architecture: Can be extended for other LLM providers.
"""

import json
import time
from typing import Dict, Any, Optional

from app.services.ai_provider import AIProvider
from google.api_core.exceptions import GoogleAPIError, ServiceUnavailable, Unauthenticated
from app.config import settings
from app.models.ai_schemas import ProcessedInput
from app.services.ai_prompts import get_input_understanding_prompt
from app.core.logger import setup_logger

logger = setup_logger(__name__)


class AIUnderstandingService:
    """Service for AI-powered input understanding and analysis using Google Gemini Flash."""

    def __init__(self):
        """Initialize AI service with Google Gemini client."""
        # Initialize provider abstraction
        self.provider = AIProvider(api_key=settings.GEMINI_API_KEY, model=settings.GEMINI_MODEL)
        if not self.provider.client:
            logger.warning("GEMINI_API_KEY not configured or provider unavailable. AI features will be limited.")

    def understand_input(
        self, content: str, input_type: str, raw_input: str
    ) -> ProcessedInput:
        """
        Analyze input and generate structured understanding.
        
        Args:
            content: Extracted or raw content to analyze
            input_type: Type of input ('text', 'csv', 'pdf', etc.)
            raw_input: Original input from user
            
        Returns:
            ProcessedInput with AI understanding
            
        Raises:
            ValueError: If API key is missing or AI service fails
        """
        start_time = time.time()
        
        if not self.provider.client:
            raise ValueError(
                "Google Gemini API key not configured. Set GEMINI_API_KEY environment variable."
            )

        logger.info(f"Starting AI analysis for input type: {input_type}")

        try:
            # Generate AI analysis
            ai_response = self._call_gemini_api(content)
            
            # Parse AI response
            analysis = self._parse_ai_response(ai_response)
            
            # Calculate processing time
            processing_time_ms = int((time.time() - start_time) * 1000)
            
            # Create structured output
            provider_used = self.provider.provider_used
            processed = ProcessedInput(
                input_type=input_type,
                entity_type=analysis.get("entity_type"),
                raw_input=raw_input,
                content=content,
                normalized_data=analysis.get("normalized_data", {}),
                summary=analysis.get("summary", "Input analyzed successfully."),
                confidence_score=float(analysis.get("confidence_score", 0.5)),
                attributes=analysis.get("attributes", {}),
                metadata={
                    "ai_provider_used": provider_used,
                    "ai_provider_fallback": self.provider.fallback_triggered,
                    "ai_model": self.provider.model_name,
                    "processing_method": "ai_understanding",
                },
                processing_time_ms=processing_time_ms,
            )
            
            logger.info(
                f"AI analysis completed for {input_type} in {processing_time_ms}ms. "
                f"Entity type: {processed.entity_type}, Confidence: {processed.confidence_score}"
            )
            
            return processed

        except Unauthenticated as e:
            error_msg = f"Gemini API authentication failed. Check GEMINI_API_KEY: {str(e)}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        except ServiceUnavailable as e:
            error_msg = f"Gemini API service unavailable: {str(e)}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        except GoogleAPIError as e:
            error_msg = f"Gemini API error: {str(e)}"
            logger.error(error_msg)
            raise ValueError(error_msg)
        except json.JSONDecodeError as e:
            error_msg = f"Failed to parse AI response: {str(e)}"
            logger.error(error_msg)
            raise ValueError(error_msg)

    def _call_gemini_api(self, content: str) -> str:
        """
        Call Google Gemini Flash API with understanding prompt.
        
        Args:
            content: Content to analyze
            
        Returns:
            Raw API response text
        """
        prompt = get_input_understanding_prompt(content)
        logger.debug("Sending request to AI provider")
        # Use provider abstraction to generate text
        return self.provider.generate(prompt, timeout=settings.AI_REQUEST_TIMEOUT_SEC, temperature=0.3)

    def _parse_ai_response(self, response_text: str) -> Dict[str, Any]:
        """
        Parse JSON response from AI.
        
        Args:
            response_text: Raw text response from Gemini API
            
        Returns:
            Parsed JSON as dictionary
        """
        # Clean response (remove markdown code blocks if present)
        cleaned = response_text.strip()
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        if cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        
        # Parse JSON
        return json.loads(cleaned.strip())


# Global AI service instance
ai_understanding_service = AIUnderstandingService()
