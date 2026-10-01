#!/usr/bin/env bash
# Guard for this PUBLIC repository (see AGENTS.md). Run by CI on every push and
# pull request; also safe to run locally before a release:
#   bash scripts/check-public-tree.sh
#
# It only inspects tracked files, so local data (credentials.json, node_modules,
# release/ ...) that is gitignored is never reported.
set -u
cd "$(git rev-parse --show-toplevel)"

fail=0
problem() { echo "::error::$1"; fail=1; }

# 1. Symlinks point outside the repository (a committed node_modules link once
#    published a local home-directory path). Nothing here needs one.
links=$(git ls-files -s | grep '^120000' | cut -f2)
[ -n "$links" ] && problem "Tracked symlink(s): $links"

# 2. Files that hold credentials, certificates or local user data.
bad=$(git ls-files | grep -iE '(^|/)(credentials\.json|data-path\.json|scorerelay-data\.json)$|\.(pfx|p12|pem|key|cer|crt|jks|keystore)$')
[ -n "$bad" ] && problem "Tracked credential/certificate/local-data file(s): $bad"

# 3. Private key material.
keys=$(git grep -nIE "BEGIN [A-Z ]*PRIVATE KEY" -- . ':!package-lock.json' ':!scripts/check-public-tree.sh')
[ -n "$keys" ] && problem "Possible private key material: $keys"

# 4. Absolute paths from a developer machine ('/Users/you/...' is a UI placeholder).
paths=$(git grep -nIE '/Users/[A-Za-z0-9._-]+|[A-Za-z]:\\Users\\[A-Za-z0-9._ -]+' -- . ':!package-lock.json' ':!scripts/check-public-tree.sh' | grep -vE '/Users/you\b')
[ -n "$paths" ] && problem "Local absolute path(s): $paths"

[ "$fail" -eq 0 ] && echo "Public-tree check passed."
exit "$fail"
