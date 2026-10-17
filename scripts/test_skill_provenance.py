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
        self.assertEqual(result["category"], "unknown")

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
        record = {"path": str(self.root), "source_type": "git", "source_ref": "https://github.com/a/b.git", "content_hash": "different"}
        with patch("skill_provenance.Path.read_bytes", side_effect=PermissionError("denied")):
            result = classify(record)
        self.assertEqual(result["category"], "downloaded")
        self.assertIn("不可读取", result["category_reason"])


    def test_missing_local_path_is_explicitly_uncertain(self):
        result = classify({"path": str(self.root / "missing"), "source_type": "local"})
        self.assertEqual(result["category"], "unknown")
        self.assertIn("待核对", result["category_reason"])

    def test_symlink_loop_does_not_crash_classification(self):
        loop = self.root / "loop"
        loop.symlink_to(loop)
        result = classify({"path": str(loop), "source_type": "local"})
        self.assertIn("待核对", result["category_reason"])

    def test_github_name_inside_local_path_is_not_remote(self):
        result = classify({"path": str(self.root), "source_ref": "/tmp/github.com/owner/skill", "source_type": "local"})
        self.assertEqual(result["category"], "unknown")

    def test_conventional_repo_skills_path_recovers_origin(self):
        repo = self.root.parent / "repo"
        skill = repo / "skills" / "learned"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("x", encoding="utf-8")
        git = repo / ".git"
        git.mkdir()
        (git / "config").write_text('[remote "origin"]\n\turl = https://github.com/example/repo.git\n', encoding="utf-8")
        result = classify({"path": str(skill), "content_hash": content_hash(skill)})
        self.assertEqual(result["category"], "downloaded")
        self.assertEqual(result["source_ref"], "https://github.com/example/repo.git")
        self.assertEqual(result["source"], "git")
        self.assertIn("基线待核对", result["category_reason"])

    def test_local_git_origin_is_not_download_evidence(self):
        repo = self.root.parent / "local-repo"
        skill = repo / "skills" / "local"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("x", encoding="utf-8")
        git = repo / ".git"
        git.mkdir()
        (git / "config").write_text('[remote "origin"]\n url = /Users/example/backup\n', encoding="utf-8")
        self.assertEqual(classify({"path": str(skill)})["category"], "unknown")

    def test_legacy_import_remote_does_not_use_local_hash_as_baseline(self):
        result = classify({"path": str(self.root), "source_type": "import", "source_ref": "https://github.com/example/repo.git", "content_hash": "different"})
        self.assertEqual(result["category"], "downloaded")
        self.assertIn("基线待核对", result["category_reason"])

    def test_github_shorthand_is_remote(self):
        result = classify({"path": str(self.root), "source_ref": "github.com/example/repo"})
        self.assertEqual(result["category"], "downloaded")

    def test_project_remote_is_not_inferred_for_agents_skill(self):
        repo = self.root.parent / "project"
        skill = repo / ".agents" / "skills" / "local"
        skill.mkdir(parents=True)
        (skill / "SKILL.md").write_text("x", encoding="utf-8")
        git = repo / ".git"
        git.mkdir()
        (git / "config").write_text('[remote "origin"]\n\turl = https://github.com/example/project.git\n', encoding="utf-8")
        result = classify({"path": str(skill)})
        self.assertEqual(result["category"], "unknown")

    def test_central_manager_repo_is_not_inferred(self):
        repo = self.root.parent / ".skills-manager" / "skills" / "central"
        repo.mkdir(parents=True)
        (repo / "SKILL.md").write_text("x", encoding="utf-8")
        git = repo.parent.parent / ".git"
        git.mkdir()
        (git / "config").write_text('[remote "origin"]\n\turl = https://github.com/example/manager.git\n', encoding="utf-8")
        result = classify({"path": str(repo)})
        self.assertEqual(result["category"], "unknown")

if __name__ == "__main__":
    unittest.main()
