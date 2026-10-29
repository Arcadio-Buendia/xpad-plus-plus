"""Exercise fresh-user setup in temporary homes; never touch the real profile."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('desktop_setup', ROOT / 'scripts/desktop_setup.py')
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)

class PortabilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.config = self.home / 'custom config'
        self.env = {**os.environ, 'HOME': str(self.home), 'XDG_CONFIG_HOME': str(self.config)}
        self.env['XDG_DATA_HOME'] = str(self.home / 'local data')
        self.env.pop('STICKY_USER_DATA', None)
        self.executable = self.home / 'my notes % app'
        self.executable.write_text('#!/bin/sh\nexit 0\n')
        self.executable.chmod(0o700)

    def run_script(self, name, *args):
        return subprocess.run([sys.executable, str(ROOT / 'scripts' / name), *map(str, args)],
                              cwd=self.home, env=self.env, text=True, capture_output=True)

    def test_autostart_without_xpad_or_default_checkout_path(self):
        preview = self.run_script('desktop_setup.py', '--executable', self.executable)
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertFalse(self.config.exists())
        applied = self.run_script('desktop_setup.py', '--apply', '--executable', self.executable)
        self.assertEqual(applied.returncode, 0, applied.stderr)
        entry = self.config / 'autostart/sticky-notes-canvas.desktop'
        self.assertIn('my notes %% app', entry.read_text())
        self.assertFalse((self.config / 'xpad').exists())
        self.assertFalse((self.config / 'sticky-notes-canvas/notes.json').exists())
        self.assertFalse((self.home / '.config').exists())

    def test_existing_autostart_is_backed_up_and_xpad_only_disabled_when_requested(self):
        old = self.config / 'autostart/xpad.desktop'
        old.parent.mkdir(parents=True)
        original = '[Desktop Entry]\nName=Xpad\nExec=xpad\n'
        old.write_text(original)
        first = self.run_script('desktop_setup.py', '--apply', '--executable', self.executable)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertEqual(old.read_text(), original)
        second = self.run_script('desktop_setup.py', '--apply', '--replace-xpad', '--executable', self.executable)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn('Hidden=true', old.read_text())
        backups = list((self.config / 'sticky-notes-canvas/autostart-backups').glob('*/xpad.desktop'))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(), original)

    def test_launcher_installs_in_xdg_data_home_without_enabling_autostart(self):
        result = self.run_script('desktop_setup.py', '--apply', '--launcher', '--executable', self.executable)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = Path(self.env['XDG_DATA_HOME'])
        entry = data / 'applications/sticky-notes-canvas.desktop'
        self.assertIn('Icon=xpad-plus-plus', entry.read_text())
        self.assertNotIn('Autostart', entry.read_text())
        self.assertTrue((data / 'icons/hicolor/256x256/apps/xpad-plus-plus.png').is_file())
        self.assertFalse((self.config / 'autostart').exists())

    def test_desktop_shortcut_uses_configured_directory_and_is_executable(self):
        self.config.mkdir()
        (self.config / 'user-dirs.dirs').write_text('XDG_DESKTOP_DIR="$HOME/My Desktop"\n')
        result = self.run_script('desktop_setup.py', '--apply', '--desktop', '--executable', self.executable)
        self.assertEqual(result.returncode, 0, result.stderr)
        shortcut = self.home / 'My Desktop/xpad-plus-plus.desktop'
        self.assertTrue(shortcut.is_file())
        self.assertTrue(os.access(shortcut, os.X_OK))
        self.assertFalse((self.home / 'Desktop').exists())

    def test_disabled_desktop_directory_does_not_put_shortcuts_in_home(self):
        self.config.mkdir()
        (self.config / 'user-dirs.dirs').write_text('XDG_DESKTOP_DIR="$HOME/"\n')
        result = self.run_script('desktop_setup.py', '--apply', '--desktop', '--executable', self.executable)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Desktop folder is disabled', result.stdout)
        self.assertFalse((self.home / 'xpad-plus-plus.desktop').exists())
        self.assertTrue((Path(self.env['XDG_DATA_HOME']) / 'applications/sticky-notes-canvas.desktop').is_file())

    def test_explicit_desktop_directory_can_be_used_alongside_autostart(self):
        destination = self.home / 'Chosen Desktop'
        result = self.run_script('desktop_setup.py', '--apply', '--desktop-dir', destination,
                                 '--autostart', '--executable', self.executable)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((destination / 'xpad-plus-plus.desktop').is_file())
        self.assertTrue((self.config / 'autostart/sticky-notes-canvas.desktop').is_file())

    def test_launcher_preview_does_not_install_files(self):
        result = self.run_script('desktop_setup.py', '--launcher', '--executable', self.executable)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(Path(self.env['XDG_DATA_HOME']).exists())

    def test_desktop_entry_escapes_reserved_characters_in_executable_paths(self):
        entry = desktop.desktop_entry(Path('/tmp/notes $cash "quoted" \\ path%'))
        self.assertIn('\\\\$', entry)
        self.assertIn('\\\\"', entry)
        self.assertIn('\\\\\\\\ path%%', entry)
        with self.assertRaises(ValueError):
            desktop.desktop_entry(Path('/tmp/notes=app'))

    def test_arm_build_is_found_on_arm_without_assuming_x64(self):
        binary = self.home / 'dist/linux-arm64-unpacked/sticky-notes-canvas'
        binary.parent.mkdir(parents=True)
        binary.write_text('test')
        binary.chmod(0o700)
        with patch.object(desktop, 'ROOT', self.home), patch.object(desktop.platform, 'machine', return_value='aarch64'):
            self.assertEqual(desktop.desktop_executable(), binary)

    def test_migration_supports_legacy_xpad_and_a_custom_canvas_data_folder(self):
        source = self.home / '.xpad'
        source.mkdir()
        body = 'A note in हिन्दी\nSecond line\n'
        (source / 'info-one').write_text('content content-one\nwidth 400\nheight 200\n', encoding='utf-8')
        (source / 'content-one').write_text(body, encoding='utf-8')
        profile = self.config / 'sticky-notes-canvas'
        profile.mkdir(parents=True)
        data = self.home / 'synced notes'
        data.mkdir()
        original = {'notes': [{'id': 'mine', 'body': 'Keep this'}]}
        (data / 'notes.json').write_text(json.dumps(original))
        (profile / 'data-folder.json').write_text(json.dumps({'path': str(data)}))
        result = self.run_script('migrate-xpad.py', '--apply', '--skip-autostart', '--preview-dir', self.home / 'preview')
        self.assertEqual(result.returncode, 0, result.stderr)
        merged = json.loads((data / 'notes.json').read_text())
        self.assertEqual(merged['notes'][0], original['notes'][0])
        self.assertEqual(merged['notes'][1]['body'], body)
        self.assertFalse((profile / 'notes.json').exists())
        self.assertFalse((self.config / 'autostart').exists())
        backup = next((profile / 'migration-backups').glob('*/notes.json'))
        self.assertEqual(json.loads(backup.read_text()), original)

    def test_missing_xpad_source_fails_without_creating_an_empty_store(self):
        result = self.run_script('migrate-xpad.py', '--apply', '--skip-autostart', '--preview-dir', self.home / 'preview')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('does not exist', result.stderr)
        self.assertFalse(self.config.exists())

    def test_browser_package_includes_font_and_license_without_host_fonts(self):
        output = self.home / 'browser output'
        result = self.run_script('package-browser.py', '--output-dir', output)
        self.assertEqual(result.returncode, 0, result.stderr)
        for filename in ['index.html', 'xpad.js', 'xpad.css', 'assets/fonts/Kalam-Regular.ttf', 'assets/fonts/Kalam-OFL.txt']:
            self.assertTrue((output / filename).is_file(), filename)
        with zipfile.ZipFile(str(output) + '.zip') as archive:
            self.assertIn('assets/fonts/Kalam-Regular.ttf', archive.namelist())
            self.assertIn('assets/fonts/Kalam-OFL.txt', archive.namelist())

if __name__ == '__main__':
    unittest.main()
