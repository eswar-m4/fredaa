import requests

q = 'site:linkedin.com/company Microsoft'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}
r = requests.get('https://www.bing.com/search', params={'q': q, 'setmkt': 'en-US'}, headers=headers, timeout=20)
text = r.text or ''
print('status', r.status_code, 'len', len(text))
for keyword in ['b_algo', 'b_context', 'b_result', 'linkedin.com/company', 'search', 'result', 'aclick', 'u=']:
    print(keyword, keyword in text, text.lower().count(keyword))
print('\nfirst 1000 chars:\n', text[:1000].replace('\n',' '))
