import sys
import pytest
sys.path.insert(0, '.')

# Run specific tests that cover SEC/MCA and LinkedIn integration
ret = pytest.main(['-q', 'tests/test_backend_workflow_features.py::test_priority_sources_sec_mca_and_linkedin_integrate_to_review_and_export'])
print('pytest exit code', ret)
