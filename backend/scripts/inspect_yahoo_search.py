import requests
import re

q = 'site:linkedin.com/company Microsoft'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}
r = requests.get('https://search.yahoo.com/search', params={'p': q}, headers=headers, timeout=20)
text = r.text or ''
print('status', r.status_code, 'len', len(text))
print('linkedin occurrences', text.lower().count('linkedin.com/company'))
print('site:linkedin occurrences', text.lower().count('site:linkedin.com/company'))

for match in re.finditer(r'(https?://[^"\s>]+linkedin\.com/company[^"\s>]+)', text, re.I):
    print('FOUND URL', match.group(1))
