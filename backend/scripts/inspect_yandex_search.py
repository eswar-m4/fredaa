import requests
import re

q = 'site:linkedin.com/company Microsoft'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
r = requests.get('https://yandex.com/search/', params={'text': q}, headers=headers, timeout=20)
text = r.text or ''
print('status', r.status_code, 'len', len(text))
print('linkedin occurrences', text.lower().count('linkedin.com/company'))
for match in re.finditer(r'<a[^>]+href=["\']([^"\']+)["\']', text, re.I|re.S):
    href = match.group(1)
    if 'linkedin.com/company' in href.lower():
        print('FOUND', href)
