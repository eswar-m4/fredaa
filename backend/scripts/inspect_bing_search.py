import requests
import re

q = 'Microsoft LinkedIn company'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
}
r = requests.get('https://www.bing.com/search', params={'q': q, 'setmkt': 'en-US'}, headers=headers, timeout=20)
print(r.status_code, len(r.text or ''))
text = r.text or ''
print('linkedin occurrences', text.lower().count('linkedin.com/company'))
anchors = re.findall(r'<a[^>]*href=[\"\']([^\"\']+)[\"\'][^>]*>(.*?)</a>', text, re.I | re.S)
print('anchors', len(anchors))
for href, title in anchors[:80]:
    if 'linkedin.com/company' in href.lower():
        print('LINK', href)
        break
