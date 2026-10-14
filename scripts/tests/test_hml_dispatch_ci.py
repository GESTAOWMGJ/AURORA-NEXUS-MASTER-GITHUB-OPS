"""Offline execution of the real dispatcher CI gate; no Actions writes."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from test_hml_auth_contract import load_workflow,WORKFLOWS

SHA='a'*40
class DispatchCITests(unittest.TestCase):
    def execute(self, status='success', sha=SHA, event='push'):
        workflow=load_workflow(WORKFLOWS/'aurora-firebase-hml-request.yml')
        script=next(s['run'] for s in workflow['jobs']['dispatch']['steps'] if s.get('id')=='evidence')
        run={'id':42,'head_sha':sha,'head_branch':'main','event':event,'created_at':'2026-01-01T00:00:00Z','status':'completed','conclusion':status}
        pulls=[{'number':246,'merged_at':'2026-01-01T00:00:00Z','merge_commit_sha':SHA,'base':{'ref':'main','repo':{'full_name':'synthetic/repo'}}}]
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'runs.json').write_text(json.dumps({'workflow_runs':[run]}));(root/'pulls.json').write_text(json.dumps(pulls))
            env=dict(os.environ,GITHUB_SHA=SHA,GITHUB_REPOSITORY='synthetic/repo',GITHUB_OUTPUT=str(root/'outputs'),MOCK_ROOT=tmp)
            for name in ('BASH_ENV','ENV','SHELLOPTS','BASHOPTS'):env.pop(name,None)
            # A gh mutation or unexpected URL fails closed in this test.
            prefix='''gh() {
  test "$1" = api || { echo UNEXPECTED_WRITE >&2; return 99; }
  case "$*" in
    *'/actions/workflows/validate-firestore-migration.yml/runs?event=push&per_page=30') cat "$MOCK_ROOT/runs.json" ;;
    *'/commits/'*'/pulls') cat "$MOCK_ROOT/pulls.json" ;;
    *) return 98 ;;
  esac
}
sleep() { :; }
'''
            result=subprocess.run(['bash','--noprofile','--norc','-c',prefix+script],env=env,capture_output=True,text=True,timeout=15)
            outputs=(root/'outputs').read_text() if (root/'outputs').exists() else ''
            return result,outputs

    def test_request_and_dispatcher_paths_trigger_push_ci(self):
        workflow=load_workflow(WORKFLOWS/'validate-firestore-migration.yml')
        for trigger in ('push','pull_request'):
            self.assertIn('.github/requests/aurora-firebase-hml.json',workflow['on'][trigger]['paths'])
            self.assertIn('.github/workflows/aurora-firebase-hml-request.yml',workflow['on'][trigger]['paths'])

    def test_successful_exact_push_ci_is_reused_without_write(self):
        result,outputs=self.execute();self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('ci_run_id=42',outputs);self.assertIn('review_pr=246',outputs)

    def test_failed_cancelled_and_wrong_candidate_are_not_approval(self):
        for status in ('failure','cancelled','timed_out'):
            result,outputs=self.execute(status=status);self.assertEqual(result.returncode,51)
            self.assertEqual(outputs,'')

    def test_independent_review_inputs_require_human_approval_without_dispatch(self):
        workflow=load_workflow(WORKFLOWS/'aurora-firebase-hml-request.yml')
        script=next(s['run'] for s in workflow['jobs']['dispatch']['steps']
                    if s.get('name')=='Prepare independent-review deployment at exact main SHA')
        self.assertNotIn('gh workflow run',script)
        env=dict(os.environ,REQUEST_FILE=str(WORKFLOWS.parent/'requests/aurora-firebase-hml.json'),
                 GITHUB_SHA=SHA,CI_RUN_ID='42',REVIEW_PR='247')
        for name in ('BASH_ENV','ENV','SHELLOPTS','BASHOPTS'):env.pop(name,None)
        result=subprocess.run(['bash','--noprofile','--norc','-c',script],env=env,capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stderr)
        receipt=json.loads(result.stdout)
        self.assertEqual(receipt['state'],'INDEPENDENT_GITHUB_REVIEW_REQUIRED')
        self.assertEqual(receipt['inputs']['expected_main_sha'],SHA)
        self.assertEqual(receipt['inputs']['active_release_ci_run_id'],'42')
        self.assertEqual(receipt['inputs']['active_release_review_pr'],'247')
        self.assertEqual(receipt['inputs']['active_release_review_mode'],'GITHUB_PULL_REQUEST_REVIEW')
        for sha,event in [('b'*40,'push'),(SHA,'workflow_dispatch')]:
            result,outputs=self.execute(sha=sha,event=event);self.assertEqual(result.returncode,52)
            self.assertEqual(outputs,'')

if __name__=='__main__':unittest.main()
