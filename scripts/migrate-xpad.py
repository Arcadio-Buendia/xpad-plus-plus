#!/usr/bin/env python3
"""Merge Xpad notes and configure GNOME autostart. Preview is the default."""
import argparse
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import socket

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path(os.environ.get('XDG_CONFIG_HOME', str(Path.home() / '.config')))

def fields(path):
    return dict(line.split(' ', 1) for line in path.read_text().splitlines() if ' ' in line)

def color(value, fallback):
    match = re.fullmatch(r'rgb\((\d+),(\d+),(\d+)\)', value or '')
    if not match:
        return fallback
    rgb = [int(n) for n in match.groups()]
    if any(n > 255 for n in rgb):
        raise ValueError('Invalid Xpad color')
    return '#' + ''.join(f'{n:02x}' for n in rgb)

def merge_xpad(source, store):
    result = dict(store)
    notes = [dict(n) for n in store.get('notes', [])]
    defaults = fields(source / 'default-style') if (source / 'default-style').exists() else {}
    ids = {n['id'] for n in notes}
    x, y, row_h = 40, max((n.get('y', 0) + n.get('h', 260) for n in notes), default=-20) + 60, 0
    imported = 0
    for info_path in sorted(source.glob('info-*')):
        info = fields(info_path)
        content_name = info.get('content', '')
        if not re.fullmatch(r'content-[\w-]+', content_name):
            raise ValueError(f'Invalid content filename in {info_path.name}')
        note_id = 'xpad-' + content_name
        if note_id in ids:
            continue
        body = (source / content_name).read_text()
        w, h = max(180, int(info.get('width', 280))), max(140, int(info.get('height', 260)))
        if x + w > 1600 and x > 40:
            x, y, row_h = 40, y + row_h + 24, 0
        font = defaults.get('fontname', 'Kalam 13') if info.get('follow_font') == '1' else info.get('fontname', 'Kalam 13')
        match = re.fullmatch(r'(.+?)\s+(\d+(?:\.\d+)?)', font)
        style = defaults if info.get('follow_color') == '1' else info
        notes.append(dict(id=note_id, title='', body=body, color='yellow',
                          padPaper=color(style.get('back'), '#fff2a8'),
                          padInk=color(style.get('text'), '#000000'),
                          padFont=match[1] if match else font,
                          padFontSize=round(float(match[2]) * 96 / 72, 2) if match else 16,
                          x=x, y=y, w=w, h=h, z=max((n.get('z', 0) for n in notes), default=0)+1,
                          folder='root', padClosed=info.get('hidden') == '1',
                          xpadSource=info_path.name))
        ids.add(note_id)
        x, row_h = x + w + 24, max(row_h, h)
        imported += 1
    result['notes'] = notes
    return result, imported

def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.migration-tmp')
    tmp.write_text(text)
    tmp.chmod(0o600)
    tmp.replace(path)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write notes and GNOME autostart to your user configuration')
    args = parser.parse_args()
    app_dir = CONFIG / 'sticky-notes-canvas'
    pointer = app_dir / 'data-folder.json'
    if pointer.exists():
        raise SystemExit('Custom data folder detected; inspect it before migrating.')
    target = app_dir / 'notes.json'
    existing = json.loads(target.read_text()) if target.exists() else {}
    merged, count = merge_xpad(CONFIG / 'xpad', existing)
    binary = ROOT / 'dist/linux-unpacked/sticky-notes-canvas'
    if not binary.is_file():
        raise SystemExit(f'Desktop build is missing: {binary}')
    # Quote Desktop Entry Exec arguments, including its special literal escapes.
    escaped = str(binary).replace('\\', '\\\\').replace('"', '\\"').replace('`', '\\`').replace('$', '\\$').replace('%', '%%')
    desktop = f'''[Desktop Entry]
Type=Application
Name=xpad++
Comment=Your notes on a transparent canvas
Exec="{escaped}"
Terminal=false
X-GNOME-Autostart-enabled=true
'''
    preview = ROOT / 'local-migration'
    preview.mkdir(exist_ok=True, mode=0o700)
    atomic_write(preview / 'notes.json', json.dumps(merged, indent=2))
    atomic_write(preview / 'sticky-notes-canvas.desktop', desktop)
    print(f'{count} Xpad notes ready to import; {len(existing.get("notes", []))} existing canvas notes preserved.')
    if not args.apply:
        print('Preview prepared. Close Sticky Notes, then run: python3 scripts/migrate-xpad.py --apply')
        return
    lock = app_dir / 'SingletonLock'
    if lock.is_symlink():
        host, _, pid = os.readlink(lock).rpartition('-')
        if host == socket.gethostname() and pid.isdigit():
            try:
                os.kill(int(pid), 0)
            except ProcessLookupError:
                pass
            else:
                raise SystemExit('Close Sticky Notes (Ctrl+Q) before applying the migration.')
    timestamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = app_dir / 'migration-backups' / timestamp
    backup.mkdir(parents=True, mode=0o700)
    if target.exists():
        shutil.copy2(target, backup / 'notes.json')
    autostart = CONFIG / 'autostart'
    entry = autostart / 'sticky-notes-canvas.desktop'
    if entry.exists():
        shutil.copy2(entry, backup / entry.name)
    atomic_write(target, json.dumps(merged, indent=2))
    atomic_write(entry, desktop)
    # Keep Xpad data intact, but avoid launching both apps at login.
    old_entry = autostart / 'xpad.desktop'
    if old_entry.exists():
        shutil.copy2(old_entry, backup / old_entry.name)
        old = old_entry.read_text()
        old = re.sub(r'^Hidden=.*\n?', '', old, flags=re.MULTILINE)
        old = old.replace('[Desktop Entry]', '[Desktop Entry]\nHidden=true', 1)
        atomic_write(old_entry, old)
    print(f'Imported {count} notes. GNOME autostart enabled; Xpad autostart disabled if present.')
    print(f'Backups: {backup}')
    print('Original Xpad note files were not modified.')

if __name__ == '__main__':
    main()
