import requests
import re
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'}
q='site:linkedin.com/company Microsoft'
url='https://www.google.com/search'
r=requests.get(url, params={'q':q,'hl':'en'}, headers=headers, timeout=20)
text=r.text or ''
print('status', r.status_code, 'len', len(text))
print('google block', 'Our systems have detected' in text or 'unusual traffic' in text)
print('linkedin count', text.lower().count('linkedin.com/company'))
print('href count', text.lower().count('href="'))
for match in re.finditer(r'href="([^"]+)"', text, re.I):
    href=match.group(1)
    if 'linkedin.com/company' in href.lower():
        print('LINK', href)
        break
print(text[:2000].replace('\n',' '))
