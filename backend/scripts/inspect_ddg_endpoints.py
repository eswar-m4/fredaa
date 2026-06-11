import requests
import re

queries = [
    "Microsoft LinkedIn company",
    "site:linkedin.com/company Microsoft",
]
urls = [
    ("html_post", "https://html.duckduckgo.com/html/"),
    ("html_get", "https://html.duckduckgo.com/html/"),
    ("lite_get", "https://lite.duckduckgo.com/lite/"),
]
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

for q in queries:
    print("\n=== QUERY:", q)
    for name, url in urls:
        try:
            if name == "html_post":
                r = requests.post(url, data={"q": q}, headers=headers, timeout=20)
            else:
                r = requests.get(url, params={"q": q}, headers=headers, timeout=20)
            print("\n", name, "status", r.status_code, "len", len(r.text or ""))
            snippet = (r.text or "")[:2000]
            print("snippet:", snippet.replace("\n", " ")[:800])
            anchors = re.findall(r"<a[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", r.text or "", re.I | re.S)
            print("anchors", len(anchors))
            if len(anchors) < 20:
                for keyword in ['result__a', 'result__snippet', 'links', 'No results', 'ddg', 'search', 'linkedin.com/company']:
                    if keyword.lower() in (r.text or "").lower():
                        print('  found keyword:', keyword)
            for href, title in anchors[:30]:
                cleaned = href.strip()
                if "linkedin.com/company" in cleaned.lower() or "uddg=" in cleaned.lower():
                    print("  ", cleaned)
        except Exception as e:
            print("  ERROR", name, e)
