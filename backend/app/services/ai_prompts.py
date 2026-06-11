"""
AI prompt templates for F.R.E.D.A input understanding.
"""


def get_input_understanding_prompt(content: str) -> str:
    """
    Generate a prompt for the AI to understand and analyze any input.
    
    This prompt asks the AI to:
    - identify what type of entity/data this is
    - extract key attributes
    - provide a confidence score
    - normalize the data
    
    Args:
        content: The extracted/raw input content to analyze
        
    Returns:
        Formatted prompt string for a generic LLM API
    """
    prompt = f"""You are an expert data understanding system that can analyze ANY type of input and extract structured information.

Analyze the following input and provide:
1. Entity type (e.g., company, person, email, url, phone, address, product, etc.)
2. Key attributes found in the input
3. A normalized/standardized representation
4. A confidence score (0.0 to 1.0) for how confident you are in your understanding
5. A brief summary

Input to analyze:
---
{content}
---

Respond with ONLY a valid JSON object (no markdown, no code blocks) with this exact structure:
{{
    "entity_type": "string (the most likely entity type)",
    "attributes": {{
        "key1": "value1",
        "key2": "value2"
    }},
    "normalized_data": {{
        "primary_key": "normalized_value"
    }},
    "confidence_score": 0.0-1.0 (float),
    "summary": "brief human-readable summary"
}}

Be concise and return ONLY the JSON object."""

    return prompt


def get_entity_classification_prompt(content: str) -> str:
    """
    Generate a prompt specifically for entity type classification.
    
    Args:
        content: Input content to classify
        
    Returns:
        Classification prompt string
    """
    prompt = f"""Classify the following input into ONE entity type.

Possible types: company, person, email, url, phone, address, product, identifier, unknown

Input:
---
{content}
---

Respond with ONLY a JSON object:
{{
    "entity_type": "string",
    "confidence": 0.0-1.0
}}"""

    return prompt
