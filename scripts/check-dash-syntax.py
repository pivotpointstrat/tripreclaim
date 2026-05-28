#!/usr/bin/env python3
"""Check inline JS syntax in dashboard/index.html."""
import re, subprocess, sys, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dash = os.path.join(root, 'landing_page', 'dashboard', 'index.html')

with open(dash, 'r') as f:
    html = f.read()

scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)
combined = '\n'.join([s for s in scripts if 'src' not in s[:20]])

with open('/tmp/dash_syntax_check.js', 'w') as f:
    f.write(combined)

result = subprocess.run(['node', '--check', '/tmp/dash_syntax_check.js'],
                       capture_output=True, text=True)
if result.returncode != 0:
    print(result.stderr[:300])
    sys.exit(1)
