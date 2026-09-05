#!/bin/sh
# Prove that `npm run lint` can actually fail, and that it looks at every source
# file — before believing a green run.
#
# ## Why this exists
#
# For an unknown length of time `npm run lint` was `eslint src/**/*.ts` with the
# pattern UNQUOTED, so the shell expanded it before eslint ever saw it. `/bin/sh`
# has no `globstar`, so `**` collapsed to `*` and the command reduced to
# `src/*/*.ts` — exactly one directory level. Measured on b7e35c1, the tree that
# shipped as 1.3.7:
#
#     .ts files under src/                 21
#     files `npm run lint` actually saw     3
#
# The eighteen it missed included sync-engine.ts, file-watcher.ts,
# mapping-manager.ts and settings.ts — the whole top level. The job printed
# nothing and exited 0, and that green was read for months as "the code is
# clean" when it meant "the glob did not match".
#
# A gate that cannot fail is not a gate, and from the outside it is
# indistinguishable from one that passes. The lint job alone cannot tell those
# apart. This script can, so it runs first.
#
# ## What it asserts
#
#   1. COVERAGE  — eslint reports on every tracked .ts file under src/.
#                  Catches the defect above and any future re-narrowing.
#   2. RED       — a deliberate violation planted in a TOP-LEVEL source file
#                  makes `npm run lint` exit non-zero. Catches the case where
#                  the rules themselves have gone silent.
#
# Fail-closed everywhere: any step that cannot be carried out is a failure, never
# a skip. "I could not check" must not read the same as "I checked and it is fine".

set -eu

PROBE_FILE="src/sync-engine.ts"     # top level on purpose: this is the class of
                                    # file the broken glob could not see
REPORT=".lint-vacuity-report.json"
PRISTINE=".lint-vacuity-pristine"

restore() {
	# Never leave the probe behind, whatever happened. Restores from a byte copy
	# taken before planting rather than from git: the CI image is not guaranteed
	# to carry git, and a cleanup that depends on a tool that may be absent is a
	# cleanup that silently does not run.
	if [ -f "$PRISTINE" ]; then
		cp "$PRISTINE" "$PROBE_FILE"
		rm -f "$PRISTINE"
	fi
	rm -f "$REPORT" .lint-probe-out
}
trap restore EXIT

test -f "$PROBE_FILE" || { echo "REFUSING: $PROBE_FILE is gone — this script names a specific top-level file on purpose; point it at another one rather than deleting the check"; exit 1; }

# ── 1. COVERAGE ─────────────────────────────────────────────────────────────
# Prefer git: tracked files are the honest set, and an untracked scratch file
# must not count as a source. Fall back to the filesystem where git is absent.
if command -v git >/dev/null 2>&1 && git rev-parse --git-dir >/dev/null 2>&1; then
	EXPECTED=$(git ls-files -- 'src' | grep '\.ts$' | wc -l | tr -d ' ')
else
	EXPECTED=$(find src -name '*.ts' -type f | wc -l | tr -d ' ')
fi
test "$EXPECTED" -gt 0 || { echo "REFUSING: found zero tracked .ts files under src/ — a count of zero makes the comparison below vacuously true"; exit 1; }

npm run --silent lint -- --format json --output-file "$REPORT" >/dev/null 2>&1 || true
test -s "$REPORT" || { echo "REFUSING: lint produced no JSON report — cannot establish what it looked at"; exit 1; }

ACTUAL=$(node -e "
	const r = require('./$REPORT');
	if (!Array.isArray(r)) { console.error('report is not an array'); process.exit(1); }
	console.log(r.length);
")

echo "tracked .ts under src/: $EXPECTED"
echo "files eslint reported on: $ACTUAL"
if [ "$ACTUAL" != "$EXPECTED" ]; then
	echo "REFUSING: lint saw $ACTUAL of $EXPECTED source files."
	echo "  The files it missed are not being checked by anything, and the job"
	echo "  still exits 0 on them. Look at the \"lint\" script in package.json:"
	echo "  an unquoted glob is expanded by the shell, not by eslint."
	exit 1
fi
echo "coverage OK: every tracked source file is linted ✓"

# ── 2. RED ──────────────────────────────────────────────────────────────────
# A green run means something only if a red one is reachable.
cp "$PROBE_FILE" "$PRISTINE"
cat >> "$PROBE_FILE" <<'PROBE'

// __lint_vacuity_probe__ — planted by scripts/assert-lint-is-not-vacuous.sh and
// removed again in the same run. If you are reading this in a commit, the script
// died between planting and restoring; delete these lines.
export function __lint_vacuity_probe__(): void {
	const raw: any = JSON.parse("{}");
	raw.nothing();
}
PROBE

set +e
npm run --silent lint > .lint-probe-out 2>&1
PROBE_STATUS=$?
set -e

cp "$PRISTINE" "$PROBE_FILE"
rm -f "$PRISTINE"

if [ "$PROBE_STATUS" -eq 0 ]; then
	echo "REFUSING: lint exited 0 on a file carrying a deliberate violation."
	echo "  Either $PROBE_FILE is not being linted, or the rules that should"
	echo "  catch an \`any\` leak are no longer active. A green lint currently"
	echo "  proves nothing."
	rm -f .lint-probe-out
	exit 1
fi

# Non-zero is necessary but not sufficient: failing for an unrelated reason would
# pass this check while proving nothing about the rule we care about.
if ! grep -q 'no-unsafe-call' .lint-probe-out; then
	echo "REFUSING: lint failed, but not for the planted violation."
	echo "  Expected @typescript-eslint/no-unsafe-call. Got:"
	sed -n '1,40p' .lint-probe-out
	exit 1
fi
rm -f .lint-probe-out

echo "red control OK: a planted violation in $PROBE_FILE fails the lint ✓"
echo
echo "lint is not vacuous: it sees every source file, and it can fail."
