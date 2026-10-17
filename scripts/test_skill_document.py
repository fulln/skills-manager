import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('skill_workflow', Path(__file__).with_name('skill_workflow.py'))
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)

class SkillDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'dev'
        self.skill = Path(self.temp.name) / 'project' / 'skill'
        self.skill.mkdir(parents=True)
        self.file = self.skill / 'SKILL.md'
        self.file.write_text('# Real skill\n中文说明', encoding='utf-8')
        connection = workflow.db(self.root)
        connection.execute('INSERT INTO skills(id,name,path) VALUES(?,?,?)', ('known', 'test', str(self.skill.resolve())))
        connection.commit()
        connection.close()

    def test_known_id_reads_existing_document_without_mutation(self):
        before = self.file.read_bytes()
        result = workflow.skill_document(self.root, 'known')
        self.assertEqual(result['content'], '# Real skill\n中文说明')
        self.assertEqual(result['central_path'], str(self.skill.resolve()))
        self.assertEqual(self.file.read_bytes(), before)
        with sqlite3.connect(self.root / 'workflow.sqlite3') as db:
            self.assertEqual(db.execute('SELECT count(*) FROM skills').fetchone()[0], 1)
            self.assertEqual(db.execute("SELECT count(*) FROM sqlite_master WHERE name='runs'").fetchone()[0], 0)

    def test_unknown_id_and_path_are_not_file_read_capabilities(self):
        for value in ['missing', str(self.file), "known' OR 1=1 --"]:
            with self.assertRaises(ValueError):
                workflow.skill_document(self.root, value)

    def test_document_symlink_cannot_escape_skill_directory(self):
        outside = Path(self.temp.name) / 'outside.txt'
        outside.write_text('private')
        self.file.unlink()
        self.file.symlink_to(outside)
        with self.assertRaises(ValueError):
            workflow.skill_document(self.root, 'known')

    def test_catalog_directory_symlink_is_supported(self):
        alias = Path(self.temp.name) / 'alias'
        alias.symlink_to(self.skill, target_is_directory=True)
        with sqlite3.connect(self.root / 'workflow.sqlite3') as db:
            db.execute('UPDATE skills SET path=? WHERE id=?', (str(alias), 'known'))
        self.assertEqual(workflow.skill_document(self.root, 'known')['central_path'], str(self.skill.resolve()))

    def test_oversized_document_is_rejected(self):
        self.file.write_bytes(b'x' * (512 * 1024 + 1))
        with self.assertRaises(ValueError):
            workflow.skill_document(self.root, 'known')

    def test_missing_document_is_reported(self):
        self.file.unlink()
        with self.assertRaises(FileNotFoundError):
            workflow.skill_document(self.root, 'known')

    def test_non_file_document_is_rejected(self):
        self.file.unlink()
        self.file.mkdir()
        with self.assertRaises(ValueError):
            workflow.skill_document(self.root, 'known')

if __name__ == '__main__':
    unittest.main()
