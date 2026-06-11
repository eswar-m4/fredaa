import requests

q = 'Microsoft LinkedIn company'
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
}
r = requests.get('https://www.bing.com/search', params={'q': q, 'setmkt': 'en-US'}, headers=headers, timeout=20)
text = r.text or ''
low = text.lower()
for i in range(low.count('aclick')):
    idx = low.find('aclick', 0 if i == 0 else prev+1)
    prev = idx
    print('occurrence', i, idx)
    print(text[max(0, idx-200):idx+200].replace('\n',' '))
    print('---')
