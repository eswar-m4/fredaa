from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)
resp = client.post('/api/v1/process-input', json={'text': 'OpenAI'})
print('STATUS:', resp.status_code)
print(resp.text)
