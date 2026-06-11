from app.config import settings
import os
print('settings.GEMINI_MODEL repr:', repr(settings.GEMINI_MODEL))
print('type:', type(settings.GEMINI_MODEL))
print('raw .env content:')
with open('.env','r', encoding='utf-8') as f:
    print(repr(f.read()))
