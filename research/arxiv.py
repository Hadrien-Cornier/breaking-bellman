#!/usr/bin/env python3
"""arxiv.py search "QUERY" | ids ID ID ... -> prints id, date, title, first authors (arXiv API over https)."""
import sys, re, urllib.request, urllib.parse, time
def get(url):
    with urllib.request.urlopen(url, timeout=60) as r: return r.read().decode()
def show(xml):
    for e in re.findall(r'<entry>(.*?)</entry>', xml, re.S):
        i = re.search(r'<id>(.*?)</id>', e).group(1).split('/abs/')[-1]
        t = ' '.join(re.search(r'<title>(.*?)</title>', e, re.S).group(1).split())
        d = re.search(r'<published>(.*?)</published>', e).group(1)[:10]
        au = re.findall(r'<name>(.*?)</name>', e)
        print(f"{i}\t{d}\t{t[:120]}\t{', '.join(au[:3])}{' et al.' if len(au) > 3 else ''}")
if sys.argv[1] == 'search':
    show(get('https://export.arxiv.org/api/query?' + urllib.parse.urlencode({'search_query': sys.argv[2], 'max_results': sys.argv[3] if len(sys.argv) > 3 else 6})))
else:
    show(get('https://export.arxiv.org/api/query?' + urllib.parse.urlencode({'id_list': ','.join(sys.argv[2:]), 'max_results': 50})))
