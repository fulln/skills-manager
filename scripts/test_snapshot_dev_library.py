import importlib.util
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('snapshot', Path(__file__).with_name('snapshot-dev-library.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SnapshotTest(unittest.TestCase):
    def test_independent_content_and_no_production_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, dest = root / 'source', root / 'dev'
            skill = source / 'skills' / 'test'
            skill.mkdir(parents=True)
            (skill / 'SKILL.md').write_text('original')
            with sqlite3.connect(source / 'skills-manager.db') as db:
                db.execute('CREATE TABLE skills (id TEXT PRIMARY KEY, name TEXT, central_path TEXT, source_type TEXT, source_ref TEXT, source_ref_resolved TEXT, content_hash TEXT)')
                db.execute('INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?)', ('one', 'test', str(skill), 'local', str(skill), None, 'old'))
                db.execute('CREATE TABLE skill_tags (skill_id TEXT, tag TEXT)')
                db.execute('INSERT INTO skill_tags VALUES (?, ?)', ('one', 'current'))
                db.execute('CREATE TABLE settings (key TEXT, value TEXT)')
                db.execute('INSERT INTO settings VALUES (?, ?)', ('credential', 'never-copy'))
            self.assertTrue(module.snapshot(source, dest)['source_database_unchanged'])
            (dest / 'skills' / 'one' / 'SKILL.md').write_text('changed')
            self.assertEqual((skill / 'SKILL.md').read_text(), 'original')
            with sqlite3.connect(dest / 'skills-manager.db') as db:
                self.assertEqual(db.execute('SELECT source_ref FROM skills').fetchone()[0], str((dest / 'skills' / 'one').resolve()))
                self.assertFalse(db.execute("SELECT name FROM sqlite_master WHERE name='settings'").fetchall())
            with self.assertRaises(ValueError):
                module.snapshot(source, dest)

    def test_rejects_overlapping_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            with self.assertRaises(ValueError):
                module.snapshot(source, source / 'nested')

    def test_symlink_rejected_without_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            skill = source / 'skill'
            skill.mkdir(parents=True)
            (skill / 'SKILL.md').write_text('safe')
            (skill / 'external').symlink_to(root)
            with sqlite3.connect(source / 'skills-manager.db') as db:
                db.execute('CREATE TABLE skills (id TEXT, name TEXT, central_path TEXT, source_type TEXT, source_ref TEXT, source_ref_resolved TEXT, content_hash TEXT)')
                db.execute('INSERT INTO skills VALUES (?, ?, ?, ?, ?, ?, ?)', ('one', 'test', str(skill), 'local', str(skill), None, None))
                db.execute('CREATE TABLE skill_tags (skill_id TEXT, tag TEXT)')
            with self.assertRaises(ValueError):
                module.snapshot(source, root / 'dev')
            self.assertFalse((root / 'dev').exists())


if __name__ == '__main__':
    unittest.main()
