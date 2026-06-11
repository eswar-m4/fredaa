import sys
from pathlib import Path
sys.path.append(str(Path(__file__).resolve().parents[1]))
from app.services.workflow_service import WorkflowService

service = WorkflowService()
result = service._discover_linkedin_with_brave('Microsoft', ['Microsoft LinkedIn company', 'site:linkedin.com/company Microsoft'])
print(result)
