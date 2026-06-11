import requests
import re

q = 'Microsoft LinkedIn company'
url = 'https://html.duckduckgo.com/html/?q=' + requests.utils.requote_uri(q)
proxy_url = 'https://api.allorigins.win/raw?url=' + requests.utils.requote_uri(url)
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}
r = requests.get(proxy_url, headers=headers, timeout=30)
print('status', r.status_code, 'len', len(r.text or ''))
text = r.text or ''
print('challenge?', 'challenge-form' in text.lower())
print('linkedin occurrences', text.lower().count('linkedin.com/company'))
print(text[:2000].replace('\n',' '))
