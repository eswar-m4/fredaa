import requests

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
}
q = 'Microsoft LinkedIn company'
url = 'https://html.duckduckgo.com/html/'
response = requests.get(url, params={'q': q}, headers=headers, timeout=20)
text = response.text or ''
print('status', response.status_code)
print('len', len(text))
print('linkedin count', text.lower().count('linkedin.com/company'))
print(text[:2000].replace('\n', ' '))
