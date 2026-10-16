import json, subprocess, sys, tempfile, unittest, sqlite3, shutil
from pathlib import Path
SCRIPT=Path(__file__).with_name('skill_workflow.py')
class WorkflowTests(unittest.TestCase):
 def setUp(self):
  self.t=Path(tempfile.mkdtemp()); (self.t/'opt'/'demo').mkdir(parents=True); (self.t/'opt'/'demo'/'.git').mkdir(); (self.t/'opt'/'demo'/'.agents'/'skills'/'alpha').mkdir(parents=True); (self.t/'opt'/'demo'/'.agents'/'skills'/'alpha'/'SKILL.md').write_text('alpha video research 视频')
  cli=self.t/'.skills-manager/bin/skills-manager-cli'; cli.parent.mkdir(parents=True); cli.write_text("#!/bin/sh\necho '[]'\n"); cli.chmod(0o755)
 def tearDown(self): shutil.rmtree(self.t)
 def call(self,*args): return json.loads(subprocess.check_output([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'--home',str(self.t),*args],text=True))
 def test_refresh_recommend_and_selection_not_usage(self):
  self.call('refresh'); x=self.call('recommend','--project',str(self.t/'opt'/'demo'),'--task','alpha'); self.assertTrue(x['candidates']); self.assertNotIn('runs',self.call('snapshot'))
 def test_unknown_candidate_rejected(self):
  self.call('refresh'); x=self.call('recommend','--project',str(self.t/'opt'/'demo'),'--task','alpha'); p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','bad','--','echo','x'],capture_output=True,text=True); self.assertNotEqual(p.returncode,0)
 def test_shell_not_interpreted_and_success(self):
  self.call('refresh'); x=self.call('recommend','--project',str(self.t/'opt'/'demo'),'--task','alpha'); p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','print("ok")'],capture_output=True,text=True); self.assertEqual(p.returncode,0); self.assertEqual(json.loads(p.stdout)['status'],'succeeded')
 def test_failure_and_idempotence(self):
  self.call('refresh'); x=self.call('recommend','--project',str(self.t/'opt'/'demo'),'--task','alpha'); p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','raise SystemExit(3)'],capture_output=True,text=True); self.assertEqual(p.returncode,3); q=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--','echo','again'],capture_output=True,text=True); self.assertNotEqual(q.returncode,0)
 def test_artifact_evidence(self):
  self.call('refresh'); x=self.call('recommend','--project',str(self.t/'opt'/'demo'),'--task','alpha'); out=self.t/'out.txt';  p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--artifact',str(out),'--',sys.executable,'-c',f'from pathlib import Path; Path({str(out)!r}).write_text("artifact")'],capture_output=True,text=True); self.assertEqual(p.returncode,0); self.assertEqual(out.read_text(),'artifact'); self.assertNotIn('runs',self.call('snapshot'))
 def test_isolation(self):
  self.call('refresh'); other=self.t/'other'; other.mkdir(); p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(other),'snapshot'],capture_output=True,text=True); self.assertEqual(json.loads(p.stdout)['projects'],[])
 def test_excluded_project_skill_not_recommended(self):
  self.call('refresh'); c=sqlite3.connect(self.t/'db/library/skills-governance.sqlite3'); c.execute('UPDATE scope_skills SET excluded=1'); c.commit(); self.assertEqual(self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha')['candidates'],[])
 def test_actual_usage_has_governance_scope_and_selection_has_no_usage(self):
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha'); self.assertFalse((self.t/'db/library/usage-events.sqlite3').exists())
  subprocess.check_output([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','print("done")'])
  u=sqlite3.connect(self.t/'db/library/usage-events.sqlite3'); g=sqlite3.connect(self.t/'db/library/skills-governance.sqlite3'); self.assertEqual(u.execute('SELECT project FROM usage_events').fetchone()[0],g.execute("SELECT id FROM scopes WHERE kind='project'").fetchone()[0])
 def test_unchanged_artifact_fails(self):
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha'); out=self.t/'old.txt'; out.write_text('old')
  p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--artifact',str(out),'--',sys.executable,'-c','print("nothing")'],capture_output=True,text=True); self.assertNotEqual(p.returncode,0); self.assertEqual(json.loads(p.stdout)['status'],'failed')
 def test_token_value_redacted_and_contract(self):
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha'); self.assertIn('instructions',x); self.assertIn('score',x['candidates'][0]); self.assertIsNone(self.call('snapshot')['sync']['error'])
  subprocess.check_output([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','pass','--token','SECRET_VALUE'])
  self.assertNotIn('SECRET_VALUE',str(self.call('snapshot'))); self.assertNotIn('SECRET_VALUE',(self.t/'db/workflow.sqlite3').read_bytes().decode('latin1'))
 def test_exclusion_after_selection_blocks_execution(self):
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha'); c=sqlite3.connect(self.t/'db/library/skills-governance.sqlite3');c.execute('UPDATE scope_skills SET excluded=1');c.commit()
  p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','pass'],capture_output=True);self.assertNotEqual(p.returncode,0);self.assertFalse((self.t/'db/library/usage-events.sqlite3').exists())
 def test_current_unlisted_project_persists_refresh(self):
  project=self.t/'other/repo';project.mkdir(parents=True);(project/'package.json').write_text('{}')
  self.call('recommend','--project',str(project),'--task','inspect');snapshot=self.call('refresh');self.assertIn(str(project.resolve()),[p['path'] for p in snapshot['projects']])
 def test_parallel_refresh_keeps_valid_snapshot(self):
  argv=[sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'--home',str(self.t),'refresh'];children=[subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(3)]
  for p in children:
   out,err=p.communicate(timeout=25);self.assertEqual(p.returncode,0,err);self.assertEqual(len(json.loads(out)['projects']),1)
 def test_execution_records_chosen_skill_not_all_candidates(self):
  other=self.t/'opt/demo/.agents/skills/beta';other.mkdir();(other/'SKILL.md').write_text('beta alpha')
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha beta');self.assertEqual(len(x['candidates']),2)
  subprocess.check_output([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','pass'])
  u=sqlite3.connect(self.t/'db/library/usage-events.sqlite3'); self.assertEqual(u.execute('SELECT skill FROM usage_events').fetchall(),[('alpha',)])
 def test_recommendation_never_stores_task_text(self):
  canary='private-description-7b13 alpha'; self.call('recommend','--project',str(self.t/'opt/demo'),'--task',canary)
  for path in (self.t/'db').rglob('*'):
   if path.is_file(): self.assertNotIn(canary.encode(),path.read_bytes())
  c=sqlite3.connect(self.t/'db/workflow.sqlite3'); self.assertIsNone(c.execute("SELECT name FROM sqlite_master WHERE name='runs'").fetchone())
 def test_legacy_history_is_not_exposed_or_appended(self):
  self.call('refresh'); c=sqlite3.connect(self.t/'db/workflow.sqlite3');c.execute('CREATE TABLE IF NOT EXISTS runs(id TEXT, task TEXT)');c.execute("INSERT INTO runs VALUES('legacy','private legacy task')");c.commit()
  self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha');self.assertNotIn('runs',self.call('snapshot'));self.assertEqual(c.execute('SELECT * FROM runs').fetchall(),[('legacy','private legacy task')])
 def test_expired_invocation_cannot_execute(self):
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha');c=sqlite3.connect(self.t/'db/workflow.sqlite3');c.execute('UPDATE pending_invocations SET created_at=0');c.commit()
  p=subprocess.run([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','pass'],capture_output=True);self.assertNotEqual(p.returncode,0);self.assertFalse((self.t/'db/library/usage-events.sqlite3').exists())
 def test_execution_consumes_selection_without_retaining_details(self):
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha');subprocess.check_output([sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c','print("private-command-detail-79fc")'])
  c=sqlite3.connect(self.t/'db/workflow.sqlite3');self.assertEqual(c.execute('SELECT COUNT(*) FROM pending_invocations').fetchone()[0],0)
  for path in (self.t/'db').rglob('*'):
   if path.is_file():self.assertNotIn(b'private-command-detail-79fc',path.read_bytes())
 def test_parallel_execution_only_runs_once(self):
  x=self.call('recommend','--project',str(self.t/'opt/demo'),'--task','alpha');out=self.t/'invoked.txt'
  argv=[sys.executable,str(SCRIPT),'--root',str(self.t/'db'),'run','--run-id',x['run_id'],'--skill','alpha','--',sys.executable,'-c',f'from pathlib import Path; import time; time.sleep(0.1); Path({str(out)!r}).open("a").write("one\\n")']
  children=[subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(2)]
  codes=[]
  for p in children:p.communicate(timeout=20);codes.append(p.returncode)
  self.assertEqual(sorted(codes),[0,1]);self.assertEqual(out.read_text(),'one\n')
if __name__=='__main__': unittest.main()
