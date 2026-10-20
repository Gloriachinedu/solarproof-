#!/usr/bin/env bash
# scripts/preflight-mainnet.sh
# ----------------------------
# Automated pre-flight checks before a Stellar mainnet deployment.
#
# Verifiable items are checked automatically and block deployment if they fail.
# Non-automatable items prompt for manual confirmation (skipped in --ci mode).
#
# Usage:
#   bash scripts/preflight-mainnet.sh            # interactive (prompts for manual items)
#   bash scripts/preflight-mainnet.sh --ci        # non-interactive (CI/CD pipelines)
#   bash scripts/preflight-mainnet.sh --dry-run   # print checks only, do not exit on failure
#
# Exit codes:
#   0 – all automated checks passed (and manual items confirmed in interactive mode)
#   1 – one or more automated checks failed
#   2 – user declined a manual confirmation item
#   3 – unexpected error
#
# Environment variables:
#   DATABASE_URL          PostgreSQL connection string for migration drift check (optional)
#   SKIP_DRIFT_CHECK      Set to "1" to skip migration drift check (e.g., no DB available)
#   GITHUB_TOKEN          Used to query open Critical issues via GitHub API (optional)
#   GITHUB_REPOSITORY     e.g. "katecatherinaa/solarproof" (auto-set in Actions)

set -euo pipefail

# ---------------------------------------------------------------------------
# Colour helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

pass()    { echo -e "  ${GREEN}✅ PASS${NC}  $*"; }
fail()    { echo -e "  ${RED}❌ FAIL${NC}  $*"; }
warn()    { echo -e "  ${YELLOW}⚠️  WARN${NC}  $*"; }
info()    { echo -e "  ${CYAN}ℹ️  INFO${NC}  $*"; }
header()  { echo -e "\n${BOLD}$*${NC}"; }

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
CI_MODE=false
DRY_RUN=false

for arg in "$@"; do
  case "$arg" in
    --ci)      CI_MODE=true ;;
    --dry-run) DRY_RUN=true ;;
    --help|-h)
      sed -n '2,/^$/p' "$0" | grep '^#' | sed 's/^# \?//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 3
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

FAILED_CHECKS=0
WARNED_CHECKS=0

record_fail() { (( FAILED_CHECKS++ )) || true; }
record_warn() { (( WARNED_CHECKS++ )) || true; }

# In dry-run mode we never exit early
maybe_fail() {
  record_fail
  if [[ "$DRY_RUN" == false ]]; then
    echo -e "\n${RED}Pre-flight failed. See above. Fix all ❌ items before deploying to mainnet.${NC}"
    exit 1
  fi
}

# ---------------------------------------------------------------------------
# Manual confirmation helper
# ---------------------------------------------------------------------------
# Prompts the user to confirm a non-automatable checklist item.
# In --ci mode, the item is skipped with a warning (caller decides if that is
# acceptable).
confirm_manual() {
  local question="$1"
  local detail="${2:-}"

  if [[ "$CI_MODE" == true ]]; then
    warn "MANUAL (skipped in CI): $question"
    record_warn
    return 0
  fi

  echo ""
  echo -e "${YELLOW}Manual check required:${NC} $question"
  [[ -n "$detail" ]] && echo "  $detail"
  printf "  Confirmed? [y/N] "
  read -r answer
  case "$answer" in
    [yY]|[yY][eE][sS])
      pass "$question"
      ;;
    *)
      fail "$question — not confirmed"
      echo -e "${RED}Deployment blocked: manual item not confirmed.${NC}"
      exit 2
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Section 1: Contract tests
# ---------------------------------------------------------------------------
header "1/5  Contract tests"

CONTRACTS_DIR="$REPO_ROOT/apps/contracts"

if [[ ! -d "$CONTRACTS_DIR" ]]; then
  fail "apps/contracts directory not found at $CONTRACTS_DIR"
  record_fail
else
  info "Running: cargo test --all (in $CONTRACTS_DIR)"
  if (cd "$CONTRACTS_DIR" && cargo test --all --quiet 2>&1); then
    pass "All contract tests pass"
  else
    fail "Contract tests failed"
    record_fail
  fi
fi

# ---------------------------------------------------------------------------
# Section 2: Audit report currency
# ---------------------------------------------------------------------------
header "2/5  Audit report"

AUDIT_DIR="$REPO_ROOT/docs/audits"
AUDIT_README="$AUDIT_DIR/README.md"

if [[ ! -f "$AUDIT_README" ]]; then
  fail "Audit README not found at $AUDIT_README"
  record_fail
else
  # Check whether a published report PDF exists in docs/audits/
  REPORT_COUNT=$(find "$AUDIT_DIR" -name "audit-*.pdf" 2>/dev/null | wc -l)
  if [[ "$REPORT_COUNT" -gt 0 ]]; then
    pass "Audit report found ($REPORT_COUNT PDF(s) in $AUDIT_DIR)"
  else
    # Check for markdown reports as a fallback
    MD_REPORT_COUNT=$(find "$AUDIT_DIR" -name "audit-*.md" 2>/dev/null | wc -l)
    if [[ "$MD_REPORT_COUNT" -gt 0 ]]; then
      pass "Audit report found ($MD_REPORT_COUNT .md report(s) in $AUDIT_DIR)"
    else
      fail "No audit report found in $AUDIT_DIR (expected audit-YYYY-MM-<firm>.pdf)"
      fail "Complete the security audit before deploying to mainnet."
      record_fail
    fi
  fi

  # Warn if audit README still says "In progress"
  if grep -q "In progress" "$AUDIT_README" 2>/dev/null; then
    warn "Audit README still shows 'In progress' — confirm audit is complete before go-live"
    record_warn
  fi
fi

# ---------------------------------------------------------------------------
# Section 3: Open Critical GitHub issues
# ---------------------------------------------------------------------------
header "3/5  Open Critical issues"

REPO="${GITHUB_REPOSITORY:-katecatherinaa/solarproof}"
GH_TOKEN="${GITHUB_TOKEN:-}"

if [[ -z "$GH_TOKEN" ]]; then
  warn "GITHUB_TOKEN not set — skipping open Critical issue check"
  warn "Set GITHUB_TOKEN to enable automatic Critical issue detection"
  record_warn
else
  info "Querying open issues labelled 'Critical' in $REPO..."
  CRITICAL_ISSUES=$(curl -sf \
    -H "Authorization: Bearer $GH_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/${REPO}/issues?labels=Critical&state=open&per_page=10" \
    2>/dev/null | jq 'length' 2>/dev/null || echo "ERROR")

  if [[ "$CRITICAL_ISSUES" == "ERROR" ]]; then
    warn "Could not query GitHub API for open Critical issues — check GITHUB_TOKEN permissions"
    record_warn
  elif [[ "$CRITICAL_ISSUES" -gt 0 ]]; then
    fail "$CRITICAL_ISSUES open Critical issue(s) found in $REPO"
    fail "Resolve all Critical issues before deploying to mainnet."
    record_fail
  else
    pass "No open Critical issues in $REPO"
  fi
fi

# ---------------------------------------------------------------------------
# Section 4: Migration drift check
# ---------------------------------------------------------------------------
header "4/5  Migration drift"

DRIFT_SCRIPT="$SCRIPT_DIR/check-migration-drift.sh"

if [[ "${SKIP_DRIFT_CHECK:-}" == "1" ]]; then
  warn "Migration drift check skipped (SKIP_DRIFT_CHECK=1)"
  record_warn
elif [[ ! -f "$DRIFT_SCRIPT" ]]; then
  fail "Drift check script not found: $DRIFT_SCRIPT"
  record_fail
elif [[ -z "${DATABASE_URL:-}" ]]; then
  warn "DATABASE_URL not set — running drift check in dry-run mode (no DB comparison)"
  bash "$DRIFT_SCRIPT" --dry-run
  warn "Set DATABASE_URL to enable full drift detection against the migration_registry table"
  record_warn
else
  info "Running migration drift check against DATABASE_URL..."
  if bash "$DRIFT_SCRIPT"; then
    pass "No migration drift detected"
  else
    fail "Migration drift detected — see output above"
    fail "Do not deploy with drifted migrations. Investigate and resolve before proceeding."
    record_fail
  fi
fi

# ---------------------------------------------------------------------------
# Section 5: Manual confirmation items
# ---------------------------------------------------------------------------
header "5/5  Manual confirmations"

if [[ "$CI_MODE" == false ]]; then
  echo -e "${YELLOW}The following items require human confirmation.${NC}"
  echo -e "${YELLOW}Answer 'y' only when you have personally verified each item.${NC}"
fi

confirm_manual \
  "Security audit report published — all Critical and High findings resolved" \
  "See docs/audits/ for the audit report. Confirm all Critical/High items are marked resolved."

confirm_manual \
  "Mainnet admin keypair stored in HSM or hardware wallet — secret never in CI" \
  "See docs/MAINNET_CHECKLIST.md §3.1"

confirm_manual \
  "Production environment variables set (ENERGY_TOKEN_ID, AUDIT_REGISTRY_ID, MINTER_SECRET_KEY, etc.)" \
  "See apps/web/.env.example for the full list. Confirm they are set in Vercel and/or secrets manager."

confirm_manual \
  "Testnet fork validation complete — all smoke tests and load tests passed" \
  "See docs/MAINNET_CHECKLIST.md Phase 2"

confirm_manual \
  "On-call rotation confirmed and incident response runbook reviewed" \
  "See docs/runbooks/incident-response.md"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo "──────────────────────────────────────────"
if [[ "$FAILED_CHECKS" -gt 0 ]]; then
  echo -e "${RED}${BOLD}Pre-flight FAILED: $FAILED_CHECKS check(s) failed, $WARNED_CHECKS warning(s).${NC}"
  echo -e "${RED}Do not deploy to mainnet until all ❌ items are resolved.${NC}"
  if [[ "$DRY_RUN" == false ]]; then
    exit 1
  fi
elif [[ "$WARNED_CHECKS" -gt 0 ]]; then
  echo -e "${YELLOW}${BOLD}Pre-flight PASSED with $WARNED_CHECKS warning(s). Review ⚠️ items.${NC}"
else
  echo -e "${GREEN}${BOLD}Pre-flight PASSED — all checks clear. ✅${NC}"
fi
echo "──────────────────────────────────────────"

# ---------------------------------------------------------------------------
# Update the last-verified date in MAINNET_CHECKLIST.md
# ---------------------------------------------------------------------------
CHECKLIST="$REPO_ROOT/docs/MAINNET_CHECKLIST.md"
TODAY=$(date +%Y-%m-%d)

if [[ -f "$CHECKLIST" && "$FAILED_CHECKS" -eq 0 ]]; then
  # Update or append "Last pre-flight check" line
  if grep -q "Last pre-flight check" "$CHECKLIST"; then
    sed -i "s/Last pre-flight check: .*/Last pre-flight check: $TODAY (automated)/" "$CHECKLIST"
  else
    echo "" >> "$CHECKLIST"
    echo "*Last pre-flight check: $TODAY (automated)*" >> "$CHECKLIST"
  fi
  info "Updated last-verified date in docs/MAINNET_CHECKLIST.md → $TODAY"
fi
