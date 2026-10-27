#!/usr/bin/env python3
"""Merge Xpad notes and configure GNOME autostart. Preview is the default."""
import argparse
import sys
import datetime
import json
import os
from pathlib import Path
import re
import shutil
import socket

ROOT = Path(__file__).resolve().parent.parent
# Also support importlib-based tests and running this script from another folder.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from desktop_setup import config_root, atomic_write, desktop_executable, install_autostart

def fields(path):
    return dict(line.split(' ', 1) for line in path.read_text(encoding='utf-8').splitlines() if ' ' in line)

def color(value, fallback):
    match = re.fullmatch(r'rgb\((\d+),(\d+),(\d+)\)', value or '')
    if not match:
        return fallback
    rgb = [int(n) for n in match.groups()]
    if any(n > 255 for n in rgb):
        raise ValueError('Invalid Xpad color')
    return '#' + ''.join(f'{n:02x}' for n in rgb)

def merge_xpad(source, store, canvas_width=1200):
    if not source.is_dir():
        raise ValueError(f'Xpad notes folder does not exist: {source}')
    if canvas_width < 180:
        raise ValueError('Canvas width must be at least 180 pixels.')
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
        body = (source / content_name).read_text(encoding='utf-8')
        w, h = max(180, int(info.get('width', 280))), max(140, int(info.get('height', 260)))
        if x + w > canvas_width and x > 40:
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

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Write notes and GNOME autostart to your user configuration')
    parser.add_argument('--preview-dir', type=Path, default=ROOT / 'local-migration', help='Directory for the private migration preview')
    parser.add_argument('--source', type=Path, help='Xpad data directory (defaults to XDG config/xpad, then ~/.xpad)')
    parser.add_argument('--user-data-dir', type=Path, help='Canvas profile directory (respects STICKY_USER_DATA)')
    parser.add_argument('--canvas-width', type=int, default=1200, help='Width for arranging imported notes, in pixels')
    parser.add_argument('--skip-autostart', action='store_true', help='Only migrate notes; do not require a desktop build')
    parser.add_argument('--executable', help='Executable or AppImage to use for autostart')
    args = parser.parse_args()
    config = config_root()
    app_dir = (args.user_data_dir or Path(os.environ.get('STICKY_USER_DATA', str(config / 'sticky-notes-canvas')))).expanduser().resolve()
    data_dir = app_dir
    pointer = app_dir / 'data-folder.json'
    if pointer.exists():
        chosen = json.loads(pointer.read_text(encoding='utf-8')).get('path')
        if chosen and Path(chosen).is_absolute():
            data_dir = Path(chosen)
            if not data_dir.is_dir() or not (data_dir / 'notes.json').is_file():
                raise SystemExit('The chosen canvas data folder is unavailable; restore it before migrating.')
    target = data_dir / 'notes.json'
    existing = json.loads(target.read_text(encoding='utf-8')) if target.exists() else {}
    source = args.source or config / 'xpad'
    if not args.source and not source.exists() and (Path.home() / '.xpad').is_dir():
        source = Path.home() / '.xpad'
    merged, count = merge_xpad(source.expanduser(), existing, args.canvas_width)
    binary = None if args.skip_autostart else desktop_executable(args.executable)
    preview = args.preview_dir.expanduser()
    preview.mkdir(exist_ok=True, mode=0o700)
    atomic_write(preview / 'notes.json', json.dumps(merged, indent=2))
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
    atomic_write(target, json.dumps(merged, indent=2, ensure_ascii=False))
    if binary:
        install_autostart(binary, replace_xpad=True, config=config)
    print(f'Imported {count} notes.' + (' Login autostart enabled; Xpad autostart disabled if present.' if binary else ' Autostart unchanged.'))
    print(f'Backups: {backup}')
    print('Original Xpad note files were not modified.')

if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as err:
        raise SystemExit(str(err))
