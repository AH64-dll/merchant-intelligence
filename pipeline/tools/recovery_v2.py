#!/usr/bin/env python3
"""Recovery v2.1: per-file base-from-latest-snapshot + forward edit replay."""
from __future__ import annotations
import json, re
from pathlib import Path

SRC = Path('/home/amr/.omp/agent/sessions/-tmp/2026-08-23T12-44-04-275Z_01a02ea6-4733-7000-97bc-3c1f9afac8f4.jsonl')
OUT = Path('/home/amr/Documents/project/pipeline')
TARGETS = [
    'merchant_intel/assignments.py', 'merchant_intel/cli.py', 'merchant_intel/config.py',
    'merchant_intel/pipeline.py', 'merchant_intel/schemas.py', 'merchant_intel/omp/client.py',
    'merchant_intel/omp/mock.py', 'tests/test_models.py',
]

def norm(p: str) -> str | None:
    p = re.sub(r'#[A-Za-z0-9]+\s*$', '', p.strip())
    for pref in ('/tmp/chat-on-steroids-linux-version-/merchant_intelligence/', '/tmp/merchant_intelligence/'):
        if p.startswith(pref):
            return p[len(pref):]
    if 'merchant_intelligence/' in p:
        tail = p.split('merchant_intelligence/', 1)[1]
        if tail:
            return tail
    return None

def resolve_block(lines: list[str], n: int) -> int:
    opener = lines[n]; stripped = opener.lstrip(); indent = len(opener) - len(stripped)
    if stripped.startswith('```'):
        for j in range(n + 1, len(lines)):
            if lines[j].lstrip().startswith('```'):
                return j
        return len(lines) - 1
    m = re.match(r'(#+)\s', stripped)
    if m:
        level = len(m.group(1))
        for j in range(n + 1, len(lines)):
            mm = re.match(r'(#+)\s', lines[j].lstrip())
            if mm and len(mm.group(1)) <= level:
                return j - 1
        return len(lines) - 1
    kw = re.match(r'(@|async\s+def\s|def\s|class\s|if\b|for\b|while\b|try\b|with\b|elif\b|else\b)', stripped)
    if kw:
        base = indent; last = n
        for j in range(n + 1, len(lines)):
            l = lines[j]
            if not l.strip():
                continue
            ind = len(l) - len(l.lstrip())
            if ind <= base:
                break
            last = j
        return last
    return n

def apply_ops(cur: list[str], rows: list[str]):
    i = 0
    while i < len(rows):
        line = rows[i]; s = line.strip()
        m = re.match(r'^(PUT|CUT)\b\s*(.*)$', s)
        if not m or line.startswith('+'):
            i += 1; continue
        kind, rest = m.group(1), m.group(2).strip()
        regm = re.search(r'\s@(\w+)$', rest)
        reg = None
        if regm:
            reg = regm.group(1); rest = rest[:regm.start()].strip()
        body = []
        j = i + 1
        while j < len(rows) and rows[j].startswith('+'):
            body.append(rows[j][1:]); j += 1
        spec0 = rest.rstrip(':').strip()
        nums = re.findall(r'\d+', spec0)
        try:
            if kind == 'CUT':
                if '*' in spec0:
                    n = int(nums[0]); end = resolve_block(cur, n - 1)
                    registers[reg or '_'] = cur[n - 1:end + 1]
                    del cur[n - 1:end + 1]
                elif len(nums) >= 2:
                    a, b = int(nums[0]), int(nums[1])
                    registers[reg or '_'] = cur[a - 1:b]
                    del cur[a - 1:b]
            elif kind == 'PUT':
                payload = list(registers.get(reg, [])) if reg else list(body)
                if spec0.startswith('<') or spec0.startswith('>'):
                    anchor = spec0[0]; core = spec0[1:]; star = '*' in core
                    if '$' in core or not nums:
                        pos = len(cur) if anchor == '>' else 0
                    elif star:
                        nn = int(nums[0]); end = resolve_block(cur, nn - 1)
                        pos = end + 1 if anchor == '>' else nn - 1
                    else:
                        nn = int(nums[0]); pos = nn if anchor == '>' else nn - 1
                    cur[pos:pos] = payload
                else:
                    a = int(nums[0]); b = int(nums[1]) if len(nums) > 1 else a
                    cur[a - 1:b] = payload
        except Exception:
            pass
        i = j

# ---- pass 1: ordered toolCall events ----
events: list[tuple[int, str, str, object]] = []
with SRC.open() as f:
    for raw in f:
        if '"toolCall"' not in raw:
            continue
        try:
            obj = json.loads(raw)
        except Exception:
            continue
        msg = obj.get('message') or {}
        content = msg.get('content')
        if not isinstance(content, list):
            continue
        for c in content:
            if c.get('type') != 'toolCall':
                continue
            name, args = c.get('name'), c.get('arguments') or {}
            idx = len(events)
            if name == 'write':
                rel = norm(args.get('path', ''))
                if rel and 'merchant_intel' in args.get('path', ''):
                    events.append((idx, 'write', rel, args.get('content', '').split('\n')))
            elif name == 'edit':
                inp = args.get('input', '')
                if 'merchant_intel' not in inp:
                    continue
                heads = re.findall(r'^\[([^\]\n#]+)(?:#[A-Za-z0-9]+)?\]', inp, re.M)
                rel = norm(heads[0]) if heads else None
                if rel:
                    events.append((idx, 'edit', rel, inp.split('\n')))
            else:
                events.append((idx, 'other', '', None))

# ---- pass 2: read snapshots keyed by event index alignment ----
snap_by_event: dict[int, tuple[str, dict[int, str]]] = {}
raw_lines = SRC.read_text().splitlines()
call_idx = 0
for ln, raw in enumerate(raw_lines):
    has_call = '"toolCall"' in raw
    has_read_result = '"toolName": "read"' in raw or '"toolName":"read"' in raw
    if has_call:
        call_idx += 1
    if not has_read_result:
        continue
    try:
        obj = json.loads(raw)
    except Exception:
        continue
    msg = obj.get('message') or {}
    content = msg.get('content')
    if not isinstance(content, list):
        continue
    for c in content:
        t = c.get('text', '') if isinstance(c.get('text'), str) else ''
        m = re.search(r'\[([^\]\n#]+)#[A-Za-z0-9]+\]', t)
        if not m:
            continue
        rel = norm(m.group(1))
        if not rel:
            continue
        lines = {int(a): b for a, b in re.findall(r'(?m)^(\d+):(.*)$', t)}
        if lines:
            # align to nearest prior toolCall event index
            snap_by_event[max(0, call_idx - 1)] = (rel, lines)

report = []
for target in ([t for t in TARGETS if t in __import__('sys').argv[1:]] or (TARGETS if len(__import__('sys').argv) == 1 else [])):
    cand = sorted(eidx for eidx, (rel, _) in snap_by_event.items() if rel == target)
    base = None
    base_idx = -1
    import sys as _sys
    only = _sys.argv[1:] or None
    scored = []
    for eidx, (rel, lines) in snap_by_event.items():
        if rel != target:
            continue
        mx = max(lines)
        scored.append((len(lines) / mx * mx, eidx, lines, mx))
    for score, eidx, lines, mx in sorted(scored, reverse=True):
        cov = len(lines) / mx
        if mx >= 20 and cov >= 0.6:
            base = [lines.get(i, '') for i in range(1, mx + 1)]
            base_idx = eidx
            break
    if base is None:
        report.append(f'{target}: NO SNAPSHOT BASE (cands={len(cand)})')
        continue
    applied = 0
    for idx, kind, rel, data in events:
        if rel != target or idx <= base_idx:
            continue
        if kind == 'edit':
            sections: dict[str, list[str]] = {}
            order: list[str] = []
            cur_key = None
            for lnn in data:
                hm = re.match(r'^\[([^\]\n#]+)(?:#[A-Za-z0-9]+)?\]$', lnn.strip())
                if hm:
                    key = norm(hm.group(1)) or target
                    if key not in sections:
                        order.append(key); sections[key] = []
                    cur_key = key
                    continue
                if cur_key is not None:
                    sections[cur_key].append(lnn)
            for key in order:
                if key != target:
                    continue
                apply_ops(base, sections[key])
                applied += 1
        elif kind == 'write':
            base = list(data)
    dest = OUT / target
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text('\n'.join(base) + '\n')
    report.append(f'{target}: base={len(base)}ln post_edits={applied}')

print('\n'.join(report))
