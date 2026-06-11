import requests
import re

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://duckduckgo.com/',
}
session = requests.Session()
resp = session.get('https://duckduckgo.com/', headers=headers, timeout=20)
print('initial', resp.status_code, resp.headers.get('set-cookie'))
q = 'Microsoft LinkedIn company'
res = session.post('https://html.duckduckgo.com/html/', data={'q': q}, headers=headers, timeout=20)
print('post', res.status_code, len(res.text or ''))
print('challenge?', 'challenge-form' in (res.text or '').lower())
print('linkedin occurrences', (res.text or '').lower().count('linkedin.com/company'))
print(res.text[:1200].replace('\n',' '))
