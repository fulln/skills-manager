import json, sqlite3, tempfile, unittest
from pathlib import Path
from workflow_discovery import discover, sync_governance

class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.t=tempfile.TemporaryDirectory(); self.root=Path(self.t.name); self.p=self.root/'demo'; (self.p/'.git').mkdir(parents=True); (self.p/'.agents/skills/local').mkdir(parents=True); (self.p/'AGENTS.md').write_text('x'); (self.p/'.agents/skills/local/SKILL.md').write_text('---\ndescription: local\n---')
        self.cli=self.root/'cli.py'; self.cli.write_text("import json;print(json.dumps([{'id':'a','name':'global','description':'d','path':'/x','tags':['现用'],'deployed_to':['codex']}]))")
    def tearDown(self): self.t.cleanup()
    def d(self): return discover(self.root,[self.p],str(self.cli))
    def test_catalog(self): self.assertEqual(self.d()['skills'][0]['id'],'a')
    def test_project(self): self.assertEqual(self.d()['projects'][0]['name'],'demo')
    def test_local_skill(self): self.assertTrue(self.d()['projects'][0]['skills'][0]['skill_file'].endswith('SKILL.md'))
    def test_missing_root_warning(self): self.assertTrue(discover(self.root,[self.root/'missing'],str(self.root/'none'))['warnings'])
    def test_config_project(self):
        (self.root/'.codex').mkdir(); (self.root/'.codex/config.toml').write_text(f'[projects."{self.p}"]\n'); self.assertEqual(self.d()['projects'][0]['source'],'codex-config')
    def test_sync_isolated(self): sync_governance(self.root,self.d()); self.assertTrue((self.root/'library/skills-governance.sqlite3').exists())
    def test_sync_global_and_local(self): sync_governance(self.root,self.d()); c=sqlite3.connect(self.root/'library/skills-governance.sqlite3'); self.assertEqual(c.execute('select count(*) from scope_skills').fetchone()[0],2)
    def test_sync_sources(self): sync_governance(self.root,self.d()); c=sqlite3.connect(self.root/'library/skills-governance.sqlite3'); self.assertEqual(c.execute('select count(*) from discovery_sources').fetchone()[0],2)
    def test_no_project_content_copy(self): self.assertNotIn('local\n',json.dumps(self.d()['skills']))

if __name__=='__main__': unittest.main()
