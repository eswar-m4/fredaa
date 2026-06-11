import requests
import re

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
})

queries = [
    "Apple LinkedIn company",
    "site:linkedin.com/company Apple",
    "Microsoft LinkedIn company",
    "site:linkedin.com/company Microsoft",
    "OpenAI LinkedIn company",
    "site:linkedin.com/company OpenAI",
    "Infosys LinkedIn company",
    "site:linkedin.com/company Infosys",
]

for q in queries:
    print('\n=== QUERY:', q)
    r = session.post('https://html.duckduckgo.com/html/', data={'q': q}, timeout=15)
    print('status:', r.status_code, 'len:', len(r.text or ''))
    snippet = (r.text or '')[:4000]
    print('\n--- HTML snippet (first 2000 chars)')
    print(snippet[:2000])
    # extract anchors (both quote types)
    anchors = re.findall(r"<a[^>]*href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", r.text or '', re.I | re.S)
    print('\nanchors found:', len(anchors))
    raw_urls = []
    for href, inner in anchors[:50]:
        if 'uddg=' in href:
            try:
                uddg = href.split('uddg=', 1)[1].split('&', 1)[0]
                href = requests.utils.unquote(uddg)
            except Exception:
                pass
        raw_urls.append(href)
    print('\nfirst 50 raw_urls:')
    for u in raw_urls[:50]:
        print(u)
