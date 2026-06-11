import requests

q = 'site:linkedin.com/company Microsoft'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
r = requests.get('https://www.bing.com/search', params={'q': q, 'setmkt': 'en-US'}, headers=headers, timeout=20)
text = r.text or ''
for i in range(text.lower().count('linkedin.com/company')):
    idx = text.lower().find('linkedin.com/company', 0 if i == 0 else prev+1)
    prev = idx
    print('occurrence', i, 'idx', idx)
    print(text[max(0, idx-200):idx+200].replace('\n',' '))
    print('---')
