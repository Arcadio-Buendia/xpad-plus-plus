#!/usr/bin/env python3
"""Configure Linux desktop-session autostart without requiring Xpad or npm at login."""
import argparse
import datetime
import os
from pathlib import Path
import platform
import shutil

ROOT = Path(__file__).resolve().parent.parent

def config_root():
    configured = os.environ.get('XDG_CONFIG_HOME', '')
    return Path(configured) if Path(configured).is_absolute() else Path.home() / '.config'

def atomic_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.setup-tmp')
    tmp.write_text(text, encoding='utf-8')
    tmp.chmod(0o600)
    tmp.replace(path)

def desktop_executable(override=None):
    if override:
        executable = Path(override).expanduser().resolve()
    else:
        arch = platform.machine().lower()
        folder = {'aarch64': 'linux-arm64-unpacked', 'arm64': 'linux-arm64-unpacked',
                  'armv7l': 'linux-armv7l-unpacked'}.get(arch, 'linux-unpacked')
        executable = ROOT / 'dist' / folder / 'sticky-notes-canvas'
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError('Build the desktop app with npm run build:desktop, or specify --executable /path/to/app.')
    return executable

def desktop_entry(executable):
    # Apply Exec quoting first, then the Desktop Entry string-value escaping.
    # The specification requires four backslashes for a literal backslash.
    value = str(executable)
    if any(character in value for character in ['\n', '\r', '=']):
        raise ValueError('A Desktop Entry executable path cannot contain newlines or an equal sign.')
    quoted = ''.join('\\' + character if character in '\\"`$' else character for character in value)
    escaped = quoted.replace('\\', '\\\\').replace('\t', '\\t').replace('%', '%%')
    return f'''[Desktop Entry]
Type=Application
Name=xpad++
Comment=Your notes on a transparent canvas
Exec="{escaped}"
Terminal=false
X-GNOME-Autostart-enabled=true
'''

def install_autostart(executable, replace_xpad=False, config=None):
    config = config or config_root()
    autostart = config / 'autostart'
    entry = autostart / 'sticky-notes-canvas.desktop'
    text = desktop_entry(executable)
    old_xpad = autostart / 'xpad.desktop'
    replacement = None
    if replace_xpad and old_xpad.is_file():
        import re
        old = re.sub(r'^Hidden=.*\n?', '', old_xpad.read_text(encoding='utf-8'), flags=re.MULTILINE)
        if '[Desktop Entry]' not in old:
            raise ValueError('The existing xpad.desktop is not a valid Desktop Entry.')
        replacement = old.replace('[Desktop Entry]', '[Desktop Entry]\nHidden=true', 1)
    timestamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    backup = config / 'sticky-notes-canvas' / 'autostart-backups' / timestamp
    previous = [entry] + ([old_xpad] if replacement is not None else [])
    for old in previous:
        if old.is_file():
            backup.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(old, backup / old.name)
    atomic_write(entry, text)
    if replacement is not None:
        atomic_write(old_xpad, replacement)
    return entry

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Enable autostart for the current user')
    parser.add_argument('--executable', help='Use an installed executable or AppImage instead of a checkout build')
    parser.add_argument('--replace-xpad', action='store_true', help='Back up and disable Xpad autostart if present')
    args = parser.parse_args()
    try:
        executable = desktop_executable(args.executable)
        if args.apply:
            entry = install_autostart(executable, args.replace_xpad)
            print(f'Login autostart enabled: {entry}')
        else:
            print(desktop_entry(executable))
            print('Preview only. Add --apply to enable login autostart.')
    except (OSError, ValueError) as err:
        parser.exit(1, f'{err}\n')

if __name__ == '__main__':
    main()
