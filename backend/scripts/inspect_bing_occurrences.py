import requests
import re
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}
q='site:linkedin.com/company Microsoft'
url='https://www.bing.com/search'
r=requests.get(url, params={'q':q,'setlang':'en-US'}, headers=headers, timeout=20)
text=r.text or ''
for term in ['linkedin.com/company', 'linkedin.com%2Fcompany', 'linkedin.com/school', 'linkedin.com%2Fschool']:
    print('TERM', term, 'count', text.lower().count(term))
    for m in re.finditer(re.escape(term), text, re.I):
        start=max(0, m.start()-80)
        end=min(len(text), m.end()+80)
        print('...', text[start:end].replace('\n',' '))
