import requests
import re
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}
q='site:linkedin.com/company Microsoft'
url='https://www.bing.com/search'
r=requests.get(url, params={'q':q,'setlang':'en-US'}, headers=headers, timeout=20)
text=r.text or ''
print('status', r.status_code, 'len', len(text))
print('linkedin.com/company count', text.lower().count('linkedin.com/company'))
print('href count', text.lower().count('href='))
print('aclk count', text.lower().count('aclk'))
print('yahoo count', text.lower().count('yahoo'))

found = False
for match in re.finditer(r'href="([^"]+)"', text, re.I):
    href=match.group(1)
    if 'linkedin.com/company' in href.lower() or 'linkedin.com/school' in href.lower():
        print('LINKEDIN HREF', href)
        found = True
    elif 'linkedin' in href.lower() and not href.startswith('/search'):
        print('LINKEDIN OTHER', href)
        found = True
if not found:
    print('no direct linkedin href found')

# print around first result
m=re.search(r'(<li class="b_algo".*?</li>)', text, re.I|re.S)
if m:
    snippet=m.group(1)
    print('found first result snippet. len', len(snippet))
    print(snippet[:2000].replace('\n',' '))
