import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('migration', Path(__file__).resolve().parents[1] / 'scripts/migrate-xpad.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)

class MigrationTests(unittest.TestCase):
    def test_merge_preserves_existing_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / 'default-style').write_text('fontname Kalam 13\nback rgb(255,238,153)\ntext rgb(0,0,0)\n')
            (source / 'info-1').write_text('content content-1\nwidth 300\nheight 180\nfollow_font 1\nfollow_color 1\nhidden 0\n')
            (source / 'content-1').write_text('First line\nSecond line\n')
            original = {'notes': [{'id': 'existing', 'body': 'Keep me', 'y': 40, 'h': 200}], 'links': ['keep']}
            merged, count = migration.merge_xpad(source, original)
            self.assertEqual(count, 1)
            self.assertEqual(merged['notes'][0], original['notes'][0])
            self.assertEqual(merged['links'], ['keep'])
            imported = merged['notes'][1]
            self.assertEqual(imported['body'], 'First line\nSecond line\n')
            self.assertEqual(imported['padPaper'], '#ffee99')
            self.assertEqual(imported['padFont'], 'Kalam')
            self.assertGreater(imported['y'], 240)
            again, count = migration.merge_xpad(source, merged)
            self.assertEqual(count, 0)
            self.assertEqual(again, merged)
            self.assertEqual((source / 'content-1').read_text(), imported['body'])

    def test_rejects_content_path_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / 'info-1').write_text('content ../private\n')
            with self.assertRaises(ValueError):
                migration.merge_xpad(source, {})

if __name__ == '__main__':
    unittest.main()
