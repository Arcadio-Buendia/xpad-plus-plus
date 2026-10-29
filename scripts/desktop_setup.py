#!/usr/bin/env python3
"""Install Linux app launchers, optional desktop shortcuts, and session autostart."""
import argparse
import datetime
import os
from pathlib import Path
import platform
import shutil
import shlex
import subprocess

ROOT = Path(__file__).resolve().parent.parent

def config_root():
    configured = os.environ.get('XDG_CONFIG_HOME', '')
    return Path(configured) if Path(configured).is_absolute() else Path.home() / '.config'

def data_root():
    configured = os.environ.get('XDG_DATA_HOME', '')
    return Path(configured) if Path(configured).is_absolute() else Path.home() / '.local/share'

def desktop_directory(config=None):
    settings = (config or config_root()) / 'user-dirs.dirs'
    directory = Path.home() / 'Desktop'
    if settings.is_file():
        for line in settings.read_text(encoding='utf-8').splitlines():
            if not line.startswith('XDG_DESKTOP_DIR='):
                continue
            parts = shlex.split(line.split('=', 1)[1], comments=True)
            if len(parts) != 1:
                raise ValueError('Invalid XDG_DESKTOP_DIR in user-dirs.dirs.')
            value = parts[0].replace('${HOME}', str(Path.home())).replace('$HOME', str(Path.home()))
            directory = Path(value).expanduser()
            if not directory.is_absolute():
                raise ValueError('XDG_DESKTOP_DIR must name an absolute directory.')
    # XDG uses HOME itself to indicate a disabled desktop directory.
    return None if directory.resolve() == Path.home().resolve() else directory

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

def desktop_entry(executable, autostart=True):
    # Apply Exec quoting first, then the Desktop Entry string-value escaping.
    # The specification requires four backslashes for a literal backslash.
    value = str(executable)
    if any(character in value for character in ['\n', '\r', '=']):
        raise ValueError('A Desktop Entry executable path cannot contain newlines or an equal sign.')
    quoted = ''.join('\\' + character if character in '\\"`$' else character for character in value)
    escaped = quoted.replace('\\', '\\\\').replace('\t', '\\t').replace('%', '%%')
    text = f'''[Desktop Entry]
Type=Application
Name=xpad++
Comment=Your notes on a transparent canvas
Exec="{escaped}"
Terminal=false
Icon=xpad-plus-plus
Categories=Office;Utility;
'''
    return text + ('X-GNOME-Autostart-enabled=true\n' if autostart else '')

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

def install_launcher(executable, desktop=False, desktop_dir=None):
    data = data_root()
    entry = data / 'applications/sticky-notes-canvas.desktop'
    text = desktop_entry(executable, autostart=False)
    icon = data / 'icons/hicolor/256x256/apps/xpad-plus-plus.png'
    icon.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'build/icons/256x256.png', icon)
    icon.chmod(0o644)

    def write_launcher(destination):
        if destination.is_file():
            timestamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
            backup = config_root() / 'sticky-notes-canvas/launcher-backups' / timestamp / destination.name
            backup.parent.mkdir(parents=True, mode=0o700)
            shutil.copy2(destination, backup)
        atomic_write(destination, text)

    write_launcher(entry)
    entry.chmod(0o644)
    shortcut = None
    if desktop:
        directory = Path(desktop_dir).expanduser().resolve() if desktop_dir else desktop_directory()
        if directory is None:
            print('Desktop folder is disabled in user-dirs.dirs; use the app menu or choose --desktop-dir.')
        else:
            shortcut = directory / 'xpad-plus-plus.desktop'
            write_launcher(shortcut)
            shortcut.chmod(0o755)
            trusted = False
            if shutil.which('gio'):
                try:
                    result = subprocess.run(['gio', 'set', str(shortcut), 'metadata::trusted', 'true'],
                                            capture_output=True, timeout=5)
                    trusted = result.returncode == 0
                except (OSError, subprocess.TimeoutExpired):
                    pass
            if not trusted:
                print('If prompted, right-click the desktop shortcut and choose Allow Launching.')
    return entry, shortcut

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Install the selected entries for the current user')
    parser.add_argument('--launcher', action='store_true', help='Install the app-menu launcher and icon')
    parser.add_argument('--desktop', action='store_true', help='Also install a desktop shortcut where enabled')
    parser.add_argument('--desktop-dir', type=Path, help='Override the desktop directory (implies --desktop)')
    parser.add_argument('--autostart', action='store_true', help='Enable autostart alongside the launcher')
    parser.add_argument('--executable', help='Use an installed executable or AppImage instead of a checkout build')
    parser.add_argument('--replace-xpad', action='store_true', help='Back up and disable Xpad autostart if present')
    args = parser.parse_args()
    try:
        executable = desktop_executable(args.executable)
        launcher = args.launcher or args.desktop or args.desktop_dir is not None
        autostart = args.autostart or not launcher
        if args.apply:
            if launcher:
                entry, shortcut = install_launcher(executable, args.desktop or args.desktop_dir is not None,
                                                   args.desktop_dir)
                print(f'App-menu launcher installed: {entry}')
                if shortcut:
                    print(f'Desktop shortcut installed: {shortcut}')
            if autostart:
                entry = install_autostart(executable, args.replace_xpad)
                print(f'Login autostart enabled: {entry}')
        else:
            print(desktop_entry(executable, autostart))
            print('Preview only. Add --apply to install the selected entries.')
    except (OSError, ValueError) as err:
        parser.exit(1, f'{err}\n')

if __name__ == '__main__':
    main()
