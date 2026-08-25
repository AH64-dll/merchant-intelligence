#!/usr/bin/env python3
"""Rebuild the merchant_intelligence package by replaying a session transcript.

Applies `write` events verbatim and `edit` events (OMP patch language) to an
in-memory line store, then emits the final tree. Block ops (`PUT N*`/`CUT N*`)
resolve via Python indentation + markdown heading rules; failures are listed.
"""
from __future__ import annotations
import json, re
from pathlib import Path

SRC = Path('/home/amr/.omp/agent/sessions/-tmp/2026-08-23T12-44-04-275Z_01a02ea6-4733-7000-97bc-3c1f9afac8f4.jsonl')
OUT = Path('/home/amr/Documents/project/pipeline')

files: dict[str, list[str]] = {}
registers: dict[str, list[str]] = {}
problems: list[str] = []
applied = {'write': 0, 'put': 0, 'cut': 0, 'mv': 0}

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
    opener = lines[n]
    stripped = opener.lstrip()
    indent = len(opener) - len(stripped)
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
        base = indent
        last = n
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

def parse_ops(rows: list[str]):
    """Yield (kind, spec, register|None, body_rows) per op; body = following +rows."""
    out = []
    i = 0
    while i < len(rows):
        line = rows[i]
        s = line.strip()
        m = re.match(r'^(PUT|CUT|MV|REM)\b\s*(.*)$', s)
        if not m or line.startswith('+'):
            i += 1
            continue
        kind, rest = m.group(1), m.group(2).strip()
        if kind == 'REM':
            out.append(('REM', '', None, []))
            break
        if kind == 'MV':
            out.append(('MV', rest, None, []))
            i += 1
            continue
        reg = None
        rm = re.search(r'\s@(\w+)\s*$', rest)
        if rm and '@name' not in rest:
            pass
        rm2 = re.search(r'\s@(\w+)$', rest)
        if rm2 and rest.split('@')[0].rstrip().endswith(('*', ':')) or (rm2 and ':' not in rest.split('@')[0][-3:] and '*' in rest.split('@')[0] or (rm2 and rest.split('@')[0].rstrip().endswith((':N',)))):
            reg = rm2.group(1)
            rest = rest[:rm2.start()].strip()
        body = []
        j = i + 1
        while j < len(rows) and rows[j].startswith('+'):
            body.append(rows[j][1:])
            j += 1
        out.append((kind, rest, reg, body))
        i = j
    return out

def apply_section(cur: list[str], ops):
    for kind, spec0, reg, body in ops:
        try:
            spec = spec0.rstrip(':').strip()
            nums = re.findall(r'\d+', spec)
            if kind == 'CUT':
                if '*' in spec:
                    n = int(nums[0])
                    end = resolve_block(cur, n - 1)
                    registers[reg or '_'] = cur[n - 1:end + 1]
                    del cur[n - 1:end + 1]
                elif len(nums) >= 2:
                    a, b = int(nums[0]), int(nums[1])
                    registers[reg or '_'] = cur[a - 1:b]
                    del cur[a - 1:b]
                applied['cut'] += 1
            elif kind == 'PUT':
                payload = list(registers[reg]) if reg else list(body)
                if reg and reg not in registers:
                    problems.append(f'missing register @{reg}')
                    continue
                if spec.startswith('<') or spec.startswith('>'):
                    anchor = spec[0]
                    core = spec[1:]
                    star = '*' in core
                    if '$' in core or not nums:
                        pos = len(cur) if anchor == '>' else 0
                    elif star:
                        nn = int(nums[0])
                        end = resolve_block(cur, nn - 1)
                        pos = end + 1 if anchor == '>' else nn - 1
                    else:
                        nn = int(nums[0])
                        pos = nn if anchor == '>' else nn - 1
                    cur[pos:pos] = payload
                else:
                    a = int(nums[0])
                    b = int(nums[1]) if len(nums) > 1 else a
                    cur[a - 1:b] = payload
                applied['put'] += 1
        except Exception as e:
            problems.append(f'{kind} {spec0!r} -> {e}')

edits = 0
with SRC.open() as f:
    for line in f:
        if '"toolCall"' not in line:
            continue
        try:
            obj = json.loads(line)
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
            if name == 'write':
                rawp = args.get('path', '')
                rel = norm(rawp)
                if rel and 'merchant_intel' in rawp:
                    files[rel] = args.get('content', '').split('\n')
                    applied['write'] += 1
            elif name == 'edit':
                inp = args.get('input', '')
                if 'merchant_intel' not in inp:
                    continue
                edits += 1
                heads = re.findall(r'^\[([^\]\n]+)\]', inp, re.M)
                if not heads:
                    problems.append(f'edit#{edits}: no header')
                    continue
                rel = norm(heads[0])
                if rel is None:
                    problems.append(f'edit#{edits}: unparsable path {heads[0]!r}')
                    continue
                cur = files.setdefault(rel, [])
                lines = inp.split('\n')
                sections: dict[str | None, list[str]] = {}
                order: list[str | None] = []
                current_key = None
                for ln in lines:
                    hm = re.match(r'^\[([^\]\n#]+)(?:#[A-Za-z0-9]+)?\]$', ln.strip())
                    if hm:
                        key = norm(hm.group(1)) or rel
                        if key not in sections:
                            order.append(key)
                            sections[key] = []
                        current_key = key
                        continue
                    if current_key is not None:
                        sections[current_key].append(ln)
                # first section's target may differ from rel (multi-file edits)
                for key in order:
                    rows = sections[key]
                    ops = parse_ops(rows)
                    if not ops and any(r.startswith('+') for r in rows):
                        # pure insertion section without explicit op: PUT >tail
                        body = [r[1:] for r in rows]
                        cur.extend(body)
                        applied['put'] += 1
                        continue
                    apply_section(cur, ops)

OUT.mkdir(parents=True, exist_ok=True)
manifest = []
for rel, ls in sorted(files.items()):
    if not rel or '..' in rel:
        continue
    dest = OUT / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text('\n'.join(ls) + '\n')
    manifest.append((rel, len(ls)))
print('applied:', applied, '| edit events:', edits)
print('files emitted:', len(manifest))
for rel, n in manifest:
    print(f'{n:5d}  {rel}')
print('--- problems ---')
for u in problems[:30]:
    print(u)
