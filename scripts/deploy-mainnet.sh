#!/usr/bin/env bash
# Deploy Soroban contracts to Stellar Mainnet.
# Idempotent: skips a contract if its address is already in the manifest.
# Outputs: scripts/deployments/mainnet.json
#
# WARNING: This deploys to production. Ensure DEPLOYER_SECRET_KEY is a
# mainnet keypair with sufficient XLM for deployment fees.
#
# Pre-flight checks are run automatically before deployment. Set
# SKIP_PREFLIGHT=1 to bypass (not recommended).

set -euo pipefail

NETWORK="mainnet"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT_DIR="$ROOT/scripts"
MANIFEST_DIR="$ROOT/scripts/deployments"
MANIFEST="$MANIFEST_DIR/${NETWORK}.json"
CONTRACTS_DIR="$ROOT/apps/contracts"
CONTRACTS=(energy_token audit_registry community_governance)

: "${DEPLOYER_SECRET_KEY:?DEPLOYER_SECRET_KEY env var is required}"

# Require explicit confirmation for mainnet
if [[ "${CONFIRM_MAINNET:-}" != "yes" ]]; then
  echo "ERROR: Set CONFIRM_MAINNET=yes to deploy to mainnet."
  exit 1
fi

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if [[ "${SKIP_PREFLIGHT:-}" == "1" ]]; then
  echo "WARNING: Pre-flight checks skipped (SKIP_PREFLIGHT=1). This is not recommended."
else
  echo "==> Running mainnet pre-flight checks..."

  # Determine mode: non-interactive in CI environments
  PREFLIGHT_ARGS=""
  if [[ -n "${CI:-}" || -n "${GITHUB_ACTIONS:-}" ]]; then
    PREFLIGHT_ARGS="--ci"
  fi

  bash "$SCRIPT_DIR/preflight-mainnet.sh" $PREFLIGHT_ARGS
  PREFLIGHT_EXIT=$?

  if [[ "$PREFLIGHT_EXIT" -ne 0 ]]; then
    echo ""
    echo "ERROR: Pre-flight checks failed (exit $PREFLIGHT_EXIT)."
    echo "       Resolve all failing checks before re-running deploy-mainnet.sh."
    exit "$PREFLIGHT_EXIT"
  fi

  echo "==> Pre-flight checks passed. Proceeding with mainnet deployment."
  echo ""
fi

# ---------------------------------------------------------------------------
# Build and deploy contracts
# ---------------------------------------------------------------------------
mkdir -p "$MANIFEST_DIR"
[[ -f "$MANIFEST" ]] || echo '{}' > "$MANIFEST"

echo "==> Building contracts for $NETWORK..."
cd "$CONTRACTS_DIR"
stellar contract build

cd "$ROOT"

for CONTRACT in "${CONTRACTS[@]}"; do
  EXISTING=$(jq -r --arg c "$CONTRACT" '.[$c] // empty' "$MANIFEST")
  if [[ -n "$EXISTING" ]]; then
    echo "==> $CONTRACT already deployed at $EXISTING — skipping"
    continue
  fi

  WASM="$CONTRACTS_DIR/target/wasm32-unknown-unknown/release/${CONTRACT}.wasm"
  echo "==> Deploying $CONTRACT..."
  ADDRESS=$(stellar contract deploy \
    --wasm "$WASM" \
    --source "$DEPLOYER_SECRET_KEY" \
    --network "$NETWORK" \
    2>&1 | tail -1)

  echo "    $CONTRACT => $ADDRESS"
  TMP=$(mktemp)
  jq --arg c "$CONTRACT" --arg a "$ADDRESS" '.[$c] = $a' "$MANIFEST" > "$TMP"
  mv "$TMP" "$MANIFEST"
done

echo ""
echo "==> Deployment manifest saved to $MANIFEST"
cat "$MANIFEST"
