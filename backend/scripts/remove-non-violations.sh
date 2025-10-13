#!/usr/bin/env bash
set -euo pipefail

# 🧹 Remove non-violating flights from the violation tracking system
# - Updated to match current repo structure (Oct 2025)
# - Location-agnostic: auto-detects repo root by finding directories "backend" and "static-site"

# Resolve the directory of this script (works for sourced and executed scripts)
SCRIPT_SRC="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd -- "$(dirname -- "$SCRIPT_SRC")" >/dev/null 2>&1 && pwd)"

find_repo_root() {
  local dir="$SCRIPT_DIR"
  while [ "$dir" != "/" ]; do
    if [ -d "$dir/backend" ] && [ -d "$dir/static-site" ]; then
      echo "$dir"
      return 0
    fi
    dir="$(dirname -- "$dir")"
  done
  return 1
}

REPO_ROOT="$(find_repo_root || true)"
if [ -z "${REPO_ROOT:-}" ]; then
  echo "❌ Could not locate repository root (expected to find 'backend' and 'static-site' directories)." >&2
  exit 1
fi

echo "🧭 Repository root detected at: $REPO_ROOT"

declare -a non_violations=(
  "2025-10-02-UNKNOWN-EGM96"
  "2025-07-31-ZT-HOT-test"
)

remove_matches() {
  local desc="$1"; shift
  local base_dir="$1"; shift
  local -a patterns=("$@")

  local found_any=false
  for pat in "${patterns[@]}"; do
    # Use -print0 to safely handle any unusual characters
    while IFS= read -r -d '' f; do
      found_any=true
      rm -f -- "$f"
      echo "✅ Removed $desc: ${f#"$REPO_ROOT/"}"
    done < <(find "$base_dir" -type f -name "$pat" -print0 2>/dev/null || true)
  done

  if [ "$found_any" = false ]; then
    echo "ℹ️  No $desc found in ${base_dir#"$REPO_ROOT/"} for patterns: ${patterns[*]}"
  fi
}

echo "🧹 Removing non-violating flights from violation tracking system..."
for flight in "${non_violations[@]}"; do
  echo ""
  echo "🗑️  Processing cleanup for: $flight"

  # 1) PNG violation screenshots (now under backend/flight-maps/[AIRCRAFT]/)
  remove_matches "PNG screenshot" "$REPO_ROOT/backend/flight-maps" "*${flight}*.png" "${flight}.png"

  # 2) Original KMLs under backend/uploads/[AIRCRAFT]/ — filenames vary, search recursively
  remove_matches "original KML" "$REPO_ROOT/backend/uploads" "*${flight}*.kml" "${flight}.kml"

  # 3) Optimized KMLs used by static site — live under static-site/kml-optimised/
  #    Current convention often ends with *_optimised.kml, but we match broadly to be robust
  remove_matches "optimized KML" "$REPO_ROOT/static-site/kml-optimised" "*${flight}*_optimised.kml" "*${flight}*.kml"

done

echo ""
echo "✅ Cleanup complete! Non-violating flights removed from violation tracking system."
echo "📝 Note: Ensure upstream filters prevent non-violations from entering the pipeline."
