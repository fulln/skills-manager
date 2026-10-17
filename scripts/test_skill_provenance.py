import os
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from skill_provenance import classify, content_hash


class ProvenanceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "skill"
        self.root.mkdir()
        (self.root / "SKILL.md").write_text("hello\n", encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def record(self, **extra):
        base = {"path": str(self.root), "source_type": "git", "source_ref": "https://github.com/a/b.git", "content_hash": content_hash(self.root)}
        base.update(extra)
        return base

    def test_downloaded_baseline(self):
        self.assertEqual(classify(self.record())["category"], "downloaded")

    def test_modified_file(self):
        (self.root / "SKILL.md").write_text("changed\n", encoding="utf-8")
        self.assertEqual(classify(self.record(content_hash="0"))["category"], "downloaded_modified")

    def test_remote_update_does_not_mean_local_modified(self):
        result = classify(self.record(source_revision="old", remote_revision="new"))
        self.assertEqual(result["category"], "downloaded")

    def test_permissions_are_hashed(self):
        before = content_hash(self.root)
        os.chmod(self.root / "SKILL.md", 0o755)
        self.assertNotEqual(before, content_hash(self.root))

    def test_ignored_files_and_dirs(self):
        before = content_hash(self.root)
        (self.root / ".gitignore").write_text("x", encoding="utf-8")
        (self.root / "x.pyc").write_bytes(b"x")
        (self.root / "__pycache__").mkdir()
        (self.root / "__pycache__" / "x").write_bytes(b"x")
        self.assertEqual(before, content_hash(self.root))

    def test_local_unknown_legacy(self):
        result = classify({"path": str(self.root), "source_type": "import"})
        self.assertEqual(result["category"], "local_packaged")

    def test_remote_ref_wins_without_source_type(self):
        result = classify({"path": str(self.root), "source_ref_resolved": "https://github.com/a/b.git"})
        self.assertEqual(result["category"], "downloaded")

    def test_missing_baseline_is_uncertain_not_modified(self):
        result = classify(self.record(content_hash=""))
        self.assertEqual(result["category"], "downloaded")
        self.assertIn("缺少", result["category_reason"])

    def test_canonical_path_resolves_alias(self):
        alias = self.root.parent / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        result = classify(self.record(path=str(alias)))
        self.assertEqual(result["canonical_path"], str(self.root.resolve()))

    def test_unreadable_hash_is_uncertain_not_modified(self):
        with patch("skill_provenance.Path.read_bytes", side_effect=PermissionError("denied")):
            result = classify({"path": str(self.root), "source_type": "git", "source_ref": "https://github.com/a/b.git", "content_hash": "different"})
        self.assertEqual(result["category"], "downloaded")
        self.assertIn("不可读取", result["category_reason"])


    def test_missing_local_path_is_explicitly_uncertain(self):
        result = classify({"path": str(self.root / "missing"), "source_type": "local"})
        self.assertEqual(result["category"], "local_packaged")
        self.assertIn("待核对", result["category_reason"])

    def test_symlink_loop_does_not_crash_classification(self):
        loop = self.root / "loop"
        loop.symlink_to(loop)
        result = classify({"path": str(loop), "source_type": "local"})
        self.assertIn("待核对", result["category_reason"])

    def test_github_name_inside_local_path_is_not_remote(self):
        result = classify({"path": str(self.root), "source_ref": "/tmp/github.com/owner/skill", "source_type": "local"})
        self.assertEqual(result["category"], "local_packaged")

if __name__ == "__main__":
    unittest.main()
