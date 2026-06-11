import requests
import re

q = 'Microsoft LinkedIn company'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
}
r = requests.get('https://www.bing.com/search', params={'q': q, 'setmkt': 'en-US'}, headers=headers, timeout=20)
text = r.text or ''
print('status', r.status_code, 'len', len(text))
url_pattern = re.compile(r'<a[^>]*href=[\"\']([^\"\']+)[\"\']', re.I | re.S)
for i, href in enumerate(url_pattern.findall(text)[:120]):
    print(i, href)
