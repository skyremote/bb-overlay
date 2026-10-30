"""Full installer contract tests against an isolated, synthetic BB CLI."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

INSTALLER = Path(__file__).resolve().parents[1] / 'install.sh'
PRO = 'navaigate-workspace@1.8.1  running\n  source: git:https://github.com/skyremote/bb-overlay.git@main'
PERSONAL = 'navaigate-skin@0.33.1  running\n  source: path:/Users/example/own-skin'
FAKE_BB = '''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['TEST_CALLS'], 'a') as f: f.write(json.dumps(args)+'\\n')
if args == ['--version']: print(os.environ.get('TEST_VERSION','0.48.0'))
elif args == ['plugin','list']: print(os.environ.get('TEST_PLUGINS',''))
elif args[:3] == ['settings','ui','get']:
    print(json.dumps(os.environ.get('TEST_NAV','navigation/rail') if args[3]=='sidebar.navigationProvider' else os.environ.get('TEST_LIST','navaigate-workspace/rail')))
elif args == ['theme','show']: print('Active: Default (default)')
elif args[:2] == ['plugin','install'] and os.environ.get('TEST_FAIL_INSTALL') in args and os.environ.get('TEST_FAIL_INSTALL'): sys.exit(1)
elif args[:2] == ['plugin','reload'] and os.environ.get('TEST_FAIL_RELOAD') in args and os.environ.get('TEST_FAIL_RELOAD'): sys.exit(1)
elif args[:3] == ['settings','ui','set'] and os.environ.get('TEST_FAIL_SETTING') in args and os.environ.get('TEST_FAIL_SETTING'): sys.exit(1)
'''

class InstallerTest(unittest.TestCase):
    def run_installer(self,*flags,code=0,**values):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name,content in [('bb',FAKE_BB),('git','#!/bin/sh\nexit 0\n')]:
                p=root/name;p.write_text(content);p.chmod(0o755)
            log=root/'calls.jsonl'
            env=dict(os.environ,PATH=tmp+os.pathsep+os.environ['PATH'],TEST_CALLS=str(log),XDG_CONFIG_HOME=str(root/'config'),**values)
            result=subprocess.run(['bash',str(INSTALLER),*flags],env=env,capture_output=True,text=True)
            self.assertEqual(result.returncode,code,result.stdout+result.stderr)
            return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else [],result.stdout

    def installs(self,calls):
        return [c[c.index('--plugin')+1] if '--plugin' in c else c[2] for c in calls if c[:2]==['plugin','install']]

    def test_fresh_defaults_to_lean_simple(self):
        calls,_=self.run_installer()
        self.assertEqual(self.installs(calls),['simple','helper-desk','cache-clock','reflect','screen-share','onboarding'])
        self.assertIn(['settings','ui','set','sidebar.threadListProvider','navaigate-simple/rail'],calls)
        self.assertIn(['settings','ui','set','sidebar.navigationProvider','navigation/rail'],calls)

    def test_fresh_explicit_pro_is_established_full_package(self):
        calls,_=self.run_installer('--edition','pro')
        self.assertIn('workspace',self.installs(calls));self.assertTrue(any('bb-plugin-agent-board' in value for value in self.installs(calls)))
        self.assertNotIn('simple',self.installs(calls))
        self.assertIn(['settings','ui','set','sidebar.threadListProvider','navaigate-workspace/rail'],calls)

    def test_existing_pro_preserves_exact_appearance(self):
        calls,_=self.run_installer(TEST_PLUGINS=PRO)
        self.assertFalse(any(c[:3]==['settings','ui','set'] or c[:2]==['theme','set'] for c in calls))
        self.assertEqual(self.installs(calls),['onboarding'])

    def test_personal_pro_is_not_replaced_by_public_workspace(self):
        calls,_=self.run_installer(TEST_PLUGINS=PERSONAL,TEST_LIST='navaigate-skin/rail')
        self.assertEqual(self.installs(calls),['onboarding'])
        self.assertFalse(any(c[:2]==['plugin','disable'] for c in calls))
        self.assertFalse(any(c[:3]==['settings','ui','set'] for c in calls))

    def test_disabled_helper_is_not_reenabled_or_updated(self):
        plugins=PRO+'\nhelper-desk@0.1.0  disabled\n  source: git:https://github.com/skyremote/bb-overlay.git@main'
        calls,_=self.run_installer(TEST_PLUGINS=plugins)
        self.assertNotIn(['plugin','enable','helper-desk'],calls)
        self.assertFalse(any(c[:3]==['plugin','update','helper-desk'] for c in calls))

    def test_existing_simple_preserves_look_and_edition(self):
        calls,_=self.run_installer(TEST_PLUGINS='navaigate-simple@1.0.0  running\n  source: git:https://github.com/skyremote/bb-overlay.git@main')
        self.assertNotIn('workspace',self.installs(calls))
        self.assertFalse(any(c[:3]==['settings','ui','set'] for c in calls))

    def test_no_look_is_respected(self):
        calls,_=self.run_installer('--no-look')
        self.assertFalse(any(c[:3]==['settings','ui','set'] or c[:2]==['theme','set'] for c in calls))

    def test_dry_run_does_not_mutate(self):
        calls,out=self.run_installer('--dry-run')
        self.assertIn('navaigate-simple/rail',out)
        self.assertFalse(any(c[:2] in [['plugin','install'],['plugin','config'],['plugin','disable'],['plugin','reload']] or c[:3]==['settings','ui','set'] for c in calls))

    def test_failed_main_install_never_switches_or_starts_guide(self):
        calls,_=self.run_installer('--edition','simple',TEST_PLUGINS=PERSONAL,TEST_FAIL_INSTALL='simple',code=1)
        self.assertFalse(any(c[:2]==['plugin','disable'] or c[:2]==['plugin','config'] or c[:3]==['settings','ui','set'] for c in calls))

    def test_explicit_simple_switch_disables_only_pro_core_and_never_uninstalls(self):
        calls,_=self.run_installer('--edition=simple',TEST_PLUGINS=PERSONAL+'\nagent-flow@1.0.0  running\n  source: path:/example/flow')
        self.assertIn(['plugin','disable','navaigate-skin'],calls)
        self.assertNotIn(['plugin','disable','agent-flow'],calls)
        self.assertFalse(any(c[:2]==['plugin','remove'] for c in calls))

    def test_return_to_personal_pro_does_not_add_absent_optional_plugins(self):
        plugins='navaigate-simple@1.0.0  running\n  source: git:https://github.com/skyremote/bb-overlay.git@main\nnavaigate-skin@0.33.1  disabled\n  source: path:/example/own-skin'
        calls,_=self.run_installer('--edition','pro',TEST_PLUGINS=plugins)
        self.assertEqual(self.installs(calls),['onboarding'])
        self.assertIn(['plugin','enable','navaigate-skin'],calls)
        self.assertIn(['plugin','disable','navaigate-simple'],calls)

    def test_switch_with_no_look_is_rejected_before_mutations(self):
        calls,_=self.run_installer('--edition','simple','--no-look',TEST_PLUGINS=PERSONAL,TEST_LIST='navaigate-skin/rail',code=1)
        self.assertFalse(any(c[:2] in [['plugin','disable'],['plugin','install']] for c in calls))

    def test_selected_pro_provider_wins_over_coinstalled_simple(self):
        plugins=PERSONAL+'\nnavaigate-simple@0.1.0  running\n  source: git:https://github.com/skyremote/bb-overlay.git@main'
        calls,_=self.run_installer(TEST_PLUGINS=plugins,TEST_LIST='navaigate-skin/rail')
        self.assertIn(['plugin','config','bb-overlay-guide','set','edition','pro'],calls)
        self.assertFalse(any(c[:3]==['settings','ui','set'] for c in calls))

    def test_reload_failure_keeps_pro_core_and_appearance(self):
        calls,_=self.run_installer('--edition','simple',TEST_PLUGINS=PERSONAL,TEST_LIST='navaigate-skin/rail',TEST_FAIL_RELOAD='navaigate-simple',code=1)
        self.assertFalse(any(c[:2]==['plugin','disable'] or c[:3]==['settings','ui','set'] for c in calls))

    def test_appearance_failure_restores_previous_and_keeps_pro_core(self):
        calls,_=self.run_installer('--edition','simple',TEST_PLUGINS=PERSONAL,TEST_LIST='navaigate-skin/rail',TEST_FAIL_SETTING='navaigate-simple/rail',code=1)
        self.assertFalse(any(c[:2]==['plugin','disable'] for c in calls))
        self.assertIn(['settings','ui','set','sidebar.threadListProvider','"navaigate-skin/rail"'],calls)
        self.assertFalse(any(c[:2]==['plugin','config'] for c in calls))

    def test_explicit_pro_keeps_selected_public_core_over_disabled_personal_core(self):
        plugins=PRO+'\nnavaigate-skin@0.33.1  disabled\n  source: path:/example/own-skin'
        calls,_=self.run_installer('--edition','pro',TEST_PLUGINS=plugins,TEST_LIST='navaigate-workspace/rail')
        self.assertNotIn(['plugin','enable','navaigate-skin'],calls)
        self.assertFalse(any(c[:3]==['settings','ui','set'] for c in calls))

    def test_no_mods_still_gets_simple_and_guide(self):
        calls,_=self.run_installer('--no-mods')
        self.assertEqual(self.installs(calls),['simple','onboarding'])

    def test_guide_configured_last_without_resetting_progress(self):
        calls,_=self.run_installer()
        config=[c for c in calls if c[:2]==['plugin','config']]
        self.assertEqual(config,[['plugin','config','bb-overlay-guide','set','edition','simple'],['plugin','config','bb-overlay-guide','set','autoStart','true']])
        self.assertGreater(calls.index(config[0]),max(i for i,c in enumerate(calls) if c[:2]==['plugin','install']))

    def test_old_bb_stops_before_any_install(self):
        calls,_=self.run_installer(TEST_VERSION='0.46.1',code=1)
        self.assertFalse(self.installs(calls))

    def test_invalid_edition_fails_before_bb_commands(self):
        calls,_=self.run_installer('--edition','unknown',code=2)
        self.assertEqual(calls,[])

if __name__=='__main__': unittest.main()
