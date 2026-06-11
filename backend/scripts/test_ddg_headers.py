import requests
import re

queries = [
    'Microsoft LinkedIn company',
    'site:linkedin.com/company Microsoft',
]
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://duckduckgo.com/',
    'Connection': 'keep-alive',
    'DNT': '1',
}

for q in queries:
    print('\n=== QUERY:', q)
    r = requests.get('https://lite.duckduckgo.com/lite/', params={'q': q}, headers=headers, timeout=20)
    print('lite_get', r.status_code, len(r.text or ''))
    print('challenge?', 'challenge-form' in (r.text or '').lower(), 'duckduckgo.com/anomaly' in (r.text or '').lower())
    print('linkedin occurrences', (r.text or '').lower().count('linkedin.com/company'))
    anchors = re.findall(r'<a[^>]*href=[\"\']([^\"\']+)[\"\']', r.text or '', re.I | re.S)
    print('anchors', len(anchors))
    for href in anchors[:40]:
        if 'linkedin.com/company' in href.lower() or 'uddg=' in href.lower():
            print('  candidate', href)
