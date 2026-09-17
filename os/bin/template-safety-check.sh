#!/usr/bin/env bash
# Template safety gate — blocks UNSAFE content from ever fanning out to the fleet.
# Invoked by: the local pre-push hook, the safety-gate.yml CI workflow, and the
# fan-out.yml dispatcher (as a pre-dispatch job). Fail-closed: any violation
# exits non-zero and stops the push / the fan-out.
#
# Catches the three things to be protected from:
#   1. SECRETS     — keys/tokens/.env leaking into a pushed template.
#   2. CLIENT LEAK — a specific client/person identifier landing in the GENERIC
#                    logic that fans out to every repo.
#   3. BREAKAGE    — merge-conflict markers or malformed skills that would break
#                    every downstream repo at once.
#
# Portable to macOS bash 3.2 (process substitution keeps counters in-shell; no
# mapfile / associative arrays).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)" || exit 2
fail=0
err() { echo "  ❌ $*"; fail=$((fail + 1)); }

# Files that legitimately contain detection patterns / the client roster — they
# live only on the template and never fan out, so the content scans skip them.
is_self() {
  case "$1" in
    bin/template-safety-check.sh|.github/workflows/fan-out.yml|.github/workflows/safety-gate.yml) return 0 ;;
    *) return 1 ;;
  esac
}

# LOGIC paths = the only things that actually fan out. Client-leak, conflict and
# skill checks run against THESE (precise; no template-only roster noise).
LOGIC_GLOBS=".claude/skills references ROUTINES.md EXPANSIONS.md wiki/_page-template.md"
logic_files() { for g in $LOGIC_GLOBS; do [ -e "$g" ] && git ls-files "$g"; done | sort -u; }

SECRET_CONTENT='BEGIN [A-Z ]*PRIVATE KEY|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}'
CLIENTS='Robinexis|Ed Robinson|Will Robinson|Venture Human Capital|Tom Searles|Xavier Morais|Magoo|Bijou|Octavia|Gideon|Summerfield'

echo "== 1. secret filenames =="
while IFS= read -r f; do
  echo "$f" | grep -qiE '(\.pem$|\.key$|-sa\.json$|(^|/)\.env$)' && err "secret-like file tracked: $f"
done < <(git ls-files)

echo "== 2. secret content =="
while IFS= read -r f; do
  is_self "$f" && continue
  file "$f" 2>/dev/null | grep -qi text || continue
  grep -qEi "$SECRET_CONTENT" "$f" 2>/dev/null && err "possible secret in: $f"
done < <(git ls-files)

echo "== 3. client identifiers in fanned-out logic =="
while IFS= read -r f; do
  is_self "$f" && continue
  grep -qEi "$CLIENTS" "$f" 2>/dev/null && err "client identifier in fanned-out logic: $f ($(grep -oEi "$CLIENTS" "$f" | sort -u | tr '\n' ',' ))"
done < <(logic_files)

echo "== 4. merge-conflict markers =="
while IFS= read -r f; do
  grep -qE '^(<<<<<<<|>>>>>>>|=======$)' "$f" 2>/dev/null && err "merge-conflict marker in: $f"
done < <(logic_files)

echo "== 5. skill frontmatter =="
while IFS= read -r sf; do
  case "$sf" in */SKILL.md|.claude/skills/*.md) ;; *) continue ;; esac
  head -20 "$sf" 2>/dev/null | grep -qE '^name:'        || err "skill missing 'name:' frontmatter: $sf"
  head -20 "$sf" 2>/dev/null | grep -qE '^description:' || err "skill missing 'description:' frontmatter: $sf"
done < <(git ls-files '.claude/skills/*' '.claude/skills/**' 2>/dev/null | grep -E '\.md$')

echo ""
if [ "$fail" -ne 0 ]; then
  echo "🛑 TEMPLATE SAFETY GATE FAILED ($fail issue(s)) — NOT safe to fan out. Fix the above."
  exit 1
fi
echo "✅ Template safety gate passed — safe to fan out."
exit 0
