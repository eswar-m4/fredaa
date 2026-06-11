import requests
import re

q = 'Microsoft LinkedIn company'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
r = requests.get('https://www.bing.com/search', params={'q': q, 'setmkt': 'en-US'}, headers=headers, timeout=20)
text = r.text or ''
for i, match in enumerate(re.finditer(r'(<a[^>]+href=["\"][^"\"]*aclick[^"\"]*["\"][^>]*>.*?</a>)', text, re.I|re.S)):
    fragment = match.group(1)
    print('MATCH', i, fragment[:400].replace('\n',' '))
    print('---')
