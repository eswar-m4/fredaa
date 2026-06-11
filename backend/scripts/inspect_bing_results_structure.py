import requests
import re
headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}
q='site:linkedin.com/company Microsoft'
url='https://www.bing.com/search'
r=requests.get(url, params={'q':q,'setlang':'en-US'}, headers=headers, timeout=20)
text=r.text or ''
print('status', r.status_code, 'len', len(text))
for term in ['class="b_algo"','class="b_caption"','class="b_attribution"','class="b_vList"']:
    print(term, 'count', text.lower().count(term.lower()))
m=re.search(r'(<li[^>]+class="b_algo".*?</li>)', text, re.I|re.S)
if m:
    print('FOUND B_ALGO', len(m.group(1)))
    print(m.group(1)[:2000].replace('\n',' '))
else:
    print('no b_algo')
