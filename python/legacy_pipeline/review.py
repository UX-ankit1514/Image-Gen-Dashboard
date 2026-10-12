"""The editorial pass.

The scraper is deliberately blind: headline is always the <h1>, key line is always the first
Highlights entry. That is what makes the set consistent, and also what produces ten IFZA
cards that read alike and cards whose key line falls back to an authority name because the
page has no Highlights at all.

This asks Claude to make those calls per page, under prompts/card-editor.md. It is optional:
if it is switched off, or Claude is not signed in, or anything fails, every caller falls back
to the deterministic values and the run completes exactly as before.
"""
import json
import os
import subprocess
import time

PROMPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'prompts', 'card-editor.md')
CLAUDE = os.path.expanduser('~/.local/bin/claude')
BATCH = 20
TIMEOUT = 900

# Claude Code loads its own tooling into every call; none of it is wanted here.
BASE_ARGS = ['-p', '--output-format', 'json',
             '--disable-slash-commands', '--strict-mcp-config', '--setting-sources', '']
NO_TOOLS = ['--disallowed-tools', 'Bash Edit Write WebFetch WebSearch Task Read Glob Grep']

PRESETS = {                       # what the three plain-language choices actually mean
    'best': ('opus', 'high'),
    'balanced': ('sonnet', 'medium'),
    'fast': ('haiku', 'low'),
}


def resolve(quality, model=None, effort=None):
    m, e = PRESETS.get(quality or 'balanced', PRESETS['balanced'])
    return (model or m), (effort or e)


def available():
    return os.path.exists(CLAUDE) or _which('claude') is not None


def _which(name):
    for d in os.environ.get('PATH', '').split(os.pathsep):
        p = os.path.join(d, name)
        if os.path.exists(p) and os.access(p, os.X_OK):
            return p
    return None


def _bin():
    return CLAUDE if os.path.exists(CLAUDE) else (_which('claude') or 'claude')


def signed_in():
    try:
        out = subprocess.run([_bin(), 'auth', 'status'], capture_output=True, text=True, timeout=60)
        return bool(json.loads(out.stdout or '{}').get('loggedIn'))
    except Exception:
        return False


def _once(prompt_text, user_text, model, effort, extra_args=(), cwd=None):
    args = [_bin()] + BASE_ARGS + ['--model', model, '--effort', effort,
                                   '--system-prompt', prompt_text] + list(extra_args)
    proc = subprocess.run(args, input=user_text, capture_output=True, text=True,
                          timeout=TIMEOUT, cwd=cwd or os.getcwd())
    if proc.returncode != 0:
        raise RuntimeError((proc.stderr or proc.stdout or 'claude exited %d' % proc.returncode).strip()[:300])
    envelope = json.loads(proc.stdout)
    if envelope.get('is_error'):
        raise RuntimeError(str(envelope.get('result'))[:300])
    text = envelope.get('result') or ''
    if not text.strip():
        # exit 0, is_error false, and nothing said: the call never reached the model
        # (zero input tokens, zero cost). Seen mid-run on a long set; it clears on retry.
        raise RuntimeError('empty reply (%s, %d input tokens)' % (
            envelope.get('stop_reason'), (envelope.get('usage') or {}).get('input_tokens', -1)))
    return text, envelope.get('total_cost_usd') or 0.0


def _call(prompt_text, user_text, model, effort, extra_args=(), cwd=None, tries=3):
    """One `claude -p` call, retried on an empty reply. Returns the text, or raises.

    Without the retry a dropped batch is invisible: the run still finishes and still writes
    every card, they just quietly keep the page's first highlight.
    """
    for attempt in range(tries):
        try:
            return _once(prompt_text, user_text, model, effort, extra_args, cwd)
        except RuntimeError:
            if attempt == tries - 1:
                raise
            time.sleep(4 * (attempt + 1))


def _json_from(text):
    """Models sometimes fence the JSON or add a sentence; take the outermost object."""
    t = (text or '').strip()
    if t.startswith('```'):
        t = t.split('\n', 1)[-1]
        t = t.rsplit('```', 1)[0]
    start = t.find('{')
    if start < 0:
        raise ValueError('no JSON object in reply')
    depth = 0
    for i in range(start, len(t)):
        if t[i] == '{':
            depth += 1
        elif t[i] == '}':
            depth -= 1
            if depth == 0:
                return json.loads(t[start:i + 1])
    raise ValueError('unterminated JSON object')


def _facts(records, shared_counts):
    """What Claude is shown: the page's own words, and who shares its photo."""
    out = []
    for r in records:
        photo = os.path.basename(r.get('image') or '')
        out.append({
            'slug': r.get('slug'),
            'h1': r.get('h1') or r.get('name'),
            'h1_length': len(r.get('h1') or r.get('name') or ''),
            'highlights': [h.get('title') for h in (r.get('highlights') or [])],
            'highlight_notes': [h.get('desc') or '' for h in (r.get('highlights') or [])],
            'authority': r.get('authority'),
            'country': r.get('country'),
            'category': r.get('category'),
            'photo': photo,
            'photo_shared_with': shared_counts.get(photo, 1) - 1,
        })
    return out


def review(records, model='sonnet', effort='medium', log=lambda *a: None):
    """Returns {slug: decision}. Never raises - a failure just means an empty result."""
    usable = [r for r in records if r.get('local_image')]
    if not usable:
        return {}, 0.0

    prompt_text = open(PROMPT).read()
    shared = {}
    for r in usable:
        k = os.path.basename(r.get('image') or '')
        shared[k] = shared.get(k, 0) + 1

    decisions, cost, calls = {}, 0.0, 0
    for b in range(0, len(usable), BATCH):
        group = usable[b:b + BATCH]
        payload = json.dumps({'products': _facts(group, shared)}, ensure_ascii=False, indent=1)
        user = ('Here are %d Arnifi product pages. Decide the headline, the key line and the '
                'photo verdict for each, following your rules. Reply with the JSON object '
                'only.\n\n%s' % (len(group), payload))
        try:
            text, spent = _call(prompt_text, user, model, effort, NO_TOOLS)
            calls += 1
            cost += spent
            for c in _json_from(text).get('cards', []):
                if c.get('slug'):
                    decisions[c['slug']] = c
            log('phase', 'review', 'read %d pages' % len(group))
        except Exception as exc:
            log('warn', 'Claude could not review a batch (%s) - using the page values' % exc)
    log('phase', 'review', '%d decisions in %d call%s' % (len(decisions), calls, '' if calls == 1 else 's'))
    missed = [r['slug'] for r in usable if r.get('slug') not in decisions]
    if missed:
        log('warn', 'Claude read %d of %d pages; the other %d keep the page\'s first '
            'highlight' % (len(decisions), len(usable), len(missed)))
    return decisions, cost


def apply_decisions(records, decisions, tighten_headlines=False, crop_photos=False):
    """Fold Claude's calls into the records. Conservative by default: it may choose among
    the page's own highlights and fill a missing one, but it never silently rewrites a
    headline the page actually has."""
    notes = []
    for r in records:
        d = decisions.get(r.get('slug'))
        if not d:
            continue
        original_key = (r.get('highlights') or [{}])[0].get('title') if r.get('highlights') else None
        original_h1 = r.get('h1') or r.get('name')

        key = (d.get('key_line') or '').strip()
        src = d.get('key_line_source') or ''
        if key and (src.startswith('highlight') or not r.get('highlights')):
            r['ai_key_line'] = key
            r['key_line_source'] = src

        head = (d.get('headline') or '').strip()
        if head and d.get('headline_source') == 'tightened':
            r['ai_headline'] = head
            if tighten_headlines:
                r['h1'] = head
                r['headline_source'] = 'tightened'

        if d.get('photo_crop') and d.get('photo_flag') == 'printed-text':
            r['ai_crop'] = d['photo_crop']
            if crop_photos:
                r['crop'] = d['photo_crop']

        notes.append({
            'slug': r.get('slug'), 'name': original_h1,
            'note': d.get('note') or '',
            'photo_flag': d.get('photo_flag'),
            'key_line': key, 'key_line_was': original_key,
            'key_line_source': src,
            'headline': head if d.get('headline_source') == 'tightened' else None,
            'headline_was': original_h1,
            'crop': d.get('photo_crop'),
            'applied_headline': bool(tighten_headlines and d.get('headline_source') == 'tightened'),
            'applied_crop': bool(crop_photos and d.get('photo_crop')),
        })
    return notes


PHOTO_BATCH = 12

PHOTO_PROMPT = """You are checking photographs that will be used as card backgrounds.

Each card puts a serif headline and a small-caps key line over the photo's BOTTOM-LEFT
corner, on top of a dark purple gradient. So a photo fails when it fights that text.

Look at each image you are given and decide:

- "printed-text"  words are printed into the artwork itself - a headline like "AMENDMENT",
                  an authority logo, a label on a document. The card would show two
                  competing headlines. This is the important one.
- "busy-corner"   no printed words, but the bottom-left third is bright or detailed enough
                  that white text would struggle.
- null            fine as it is.

When you answer "printed-text", also give the LARGEST region of the frame that is free of
printed words, as fractions of the full width and height. The card is a wide 16:10 frame, so
a wide region is worth much more than a tall narrow one - a vertical strip cannot fill the
card. Give the region honestly even if it is small; code decides whether it is usable.
Return null only if no part of the frame is clear.

Read every image path you are given, then reply with JSON only:

{"photos":[{"photo":"<filename as given>","flag":null|"printed-text"|"busy-corner",
            "crop":null|{"x":0.0,"y":0.0,"w":1.0,"h":1.0},
            "note":"one plain sentence a designer would say"}]}

No prose outside the JSON."""


def photo_pass(cands, model='sonnet', effort='medium', log=lambda *a: None):
    """Ask Claude to actually look at the suspect photos. One call for the whole shortlist."""
    if not cands:
        return {}, 0.0
    dirs = sorted({os.path.dirname(c['path']) for c in cands})
    extra = ['--allowed-tools', 'Read']
    for d in dirs:
        extra += ['--add-dir', d]

    out, total = {}, 0.0
    for i in range(0, len(cands), PHOTO_BATCH):        # a dozen images is enough for one
        group = cands[i:i + PHOTO_BATCH]               # call to read carefully
        listing = '\n'.join('- %s  (%s)' % (c['path'], c['photo']) for c in group)
        user = ('Read each of these %d images with the Read tool, then judge them.\n\n%s\n\n'
                'Reply with the JSON object only.' % (len(group), listing))
        try:
            text, cost = _call(PHOTO_PROMPT, user, model, effort, extra, cwd=dirs[0])
            total += cost
            for p in _json_from(text).get('photos', []):
                if p.get('photo'):
                    out[os.path.basename(p['photo'])] = p
        except Exception as exc:
            log('warn', 'Claude could not check the photos (%s)' % exc)
    if out:
        log('phase', 'review', 'looked at %d photos' % len(out))
    return out, total
