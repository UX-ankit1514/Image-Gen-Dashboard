"""Reassembling Next.js React-Flight payloads.

Arnifi streams its page data as `self.__next_f.push([1,"<chunk>"])` script tags. Joining
the decoded chunks rebuilds one long string containing the real records, which is far more
stable than scraping the DOM - the listing markup keys off Emotion class hashes like
`mui-29kdqi` that change on any rebuild, while these records do not.
"""
import json
import re

_PUSH = re.compile(r'self\.__next_f\.push\(\[1,(".*?")\]\)</script>', re.S)


def payload(page_html):
    return ''.join(json.loads(p) for p in _PUSH.findall(page_html))


def objects(buf, key):
    """Every JSON object appearing as `"<key>": { ... }`, brace-matched and decoded.

    Regex cannot do this - the objects nest - so scan for the matching close brace.
    """
    out = []
    for m in re.finditer(r'"%s":\s*\{' % re.escape(key), buf):
        start = buf.index('{', m.end() - 1)
        depth = 0
        end = -1
        for j in range(start, len(buf)):
            c = buf[j]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    end = j
                    break
        if end < 0:
            continue
        try:
            out.append(json.loads(buf[start:end + 1]))
        except ValueError:
            continue
    return out
