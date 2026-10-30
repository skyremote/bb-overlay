"""Exercise the full installer against a fake bb, without touching user state."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

INSTALLER = Path(__file__).resolve().parents[1] / 'install.sh'
FAKE_BB = '''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['TEST_CALLS'], 'a') as f:
    f.write(json.dumps(args) + '\\n')
if args == ['--version']:
    print(os.environ.get('TEST_VERSION', '0.48.0'))
elif args == ['plugin', 'list']:
    print('navaigate-workspace@1.8.1  running\\n  source: git:https://github.com/skyremote/bb-overlay.git@main')
elif args[:3] == ['settings', 'ui', 'get']:
    if args[3] == 'sidebar.navigationProvider': print(json.dumps(os.environ.get('TEST_NAV', '__automatic__')))
    elif args[3] == 'sidebar.threadListProvider': print(json.dumps(os.environ.get('TEST_LIST', '')))
elif args == ['theme', 'show']:
    print('plugin:navaigate-workspace:navaigate')
'''


class NavigationDefaultTest(unittest.TestCase):
    def run_installer(self, *flags, **values):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name, content in [('bb', FAKE_BB), ('git', '#!/bin/sh\nexit 0\n')]:
                p = root / name
                p.write_text(content)
                p.chmod(0o755)
            log = root / 'calls.jsonl'
            env = dict(os.environ, PATH=tmp + os.pathsep + os.environ['PATH'], TEST_CALLS=str(log), **values)
            result = subprocess.run(['bash', str(INSTALLER), *flags], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            import json
            return [json.loads(line) for line in log.read_text().splitlines()], result.stdout

    def test_fresh_install_pins_navigation_separately_from_thread_list(self):
        calls, _ = self.run_installer()
        self.assertIn(['settings', 'ui', 'set', 'sidebar.navigationProvider', 'navigation/rail'], calls)
        self.assertIn(['settings', 'ui', 'set', 'sidebar.threadListProvider', 'navaigate-workspace/rail'], calls)

    def test_personal_thread_list_still_gets_navigation_fix(self):
        calls, _ = self.run_installer(TEST_LIST='navaigate-skin/rail')
        self.assertIn(['settings', 'ui', 'set', 'sidebar.navigationProvider', 'navigation/rail'], calls)
        self.assertFalse(any(c[:4] == ['settings', 'ui', 'set', 'sidebar.threadListProvider'] for c in calls))

    def test_no_look_preserves_all_appearance(self):
        calls, _ = self.run_installer('--no-look')
        self.assertFalse(any(c[:3] == ['settings', 'ui', 'set'] or c[:2] == ['theme', 'set'] for c in calls))

    def test_older_bb_does_not_select_unavailable_navigation(self):
        calls, _ = self.run_installer(TEST_VERSION='0.46.1')
        self.assertFalse(any('sidebar.navigationProvider' in c for c in calls))

    def test_existing_icon_rail_is_idempotent(self):
        calls, _ = self.run_installer(TEST_NAV='navigation/rail')
        self.assertNotIn(['settings', 'ui', 'set', 'sidebar.navigationProvider', 'navigation/rail'], calls)

    def test_dry_run_never_writes(self):
        calls, output = self.run_installer('--dry-run')
        self.assertIn('bb settings ui set sidebar.navigationProvider navigation/rail', output)
        self.assertFalse(any(c[:3] == ['settings', 'ui', 'set'] or c[:2] == ['theme', 'set'] for c in calls))


if __name__ == '__main__':
    unittest.main()
