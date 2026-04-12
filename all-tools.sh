#!/usr/bin/env bash
set -euo pipefail

IMAGE="${TRUSTINN_IMAGE:-rajeshbyreddy95/trustinn-tools:3.1.4}"
PLATFORM="${TRUSTINN_PLATFORM:-linux/amd64}"
RESULTS_DIR="${TRUSTINN_RESULTS_DIR:-$HOME/Documents/results}"

C_TOOLS=(
  "Condition Satisfiability Analysis"
  "DSE based Mutation Analyser"
  "Dynamic Symbolic Execution"
  "Dynamic Symbolic Execution with Pruning"
  "Advance Code Coverage Profiler"
  "Mutation Testing Profiler"
)

JAVA_TOOLS=("JBMC")
PYTHON_TOOLS=("Condition Coverage Fuzzing")
SOLIDITY_TOOLS=("VeriSol")

usage() {
  cat <<'EOF'
Usage:
  ./all-tools.sh tools
  ./all-tools.sh list-samples <language> <tool>
  ./all-tools.sh run-sample <language> <tool> <sample_path> [params]
  ./all-tools.sh run-file <language> <tool> <file_path> [params]
  ./all-tools.sh run-all-c <sample_path>

Examples:
  ./all-tools.sh tools
  ./all-tools.sh list-samples c "Condition Satisfiability Analysis"
  ./all-tools.sh run-sample c "DSE based Mutation Analyser" "/opt/trustinn/samples/c/sample.c"
  ./all-tools.sh run-file solidity "VeriSol" "$PWD/Contract.sol" "{solidityMode:chc}"
  ./all-tools.sh run-all-c "/opt/trustinn/samples/c/sample.c"

Env overrides:
  TRUSTINN_IMAGE, TRUSTINN_PLATFORM, TRUSTINN_RESULTS_DIR
EOF
}

default_params() {
  local language="$1"
  local tool="$2"

  if [[ "$language" == "solidity" ]]; then
    echo "{solidityMode:bmc}"
    return
  fi

  case "$tool" in
    "Condition Satisfiability Analysis")
      echo "{cbmcBound:10}"
      ;;
    "DSE based Mutation Analyser")
      echo "{kleemaValue:3}"
      ;;
    "Dynamic Symbolic Execution")
      echo "{}"
      ;;
    "Dynamic Symbolic Execution with Pruning")
      echo "{}"
      ;;
    "Advance Code Coverage Profiler")
      echo "{gmcovVersion:4,gmcovTimebound:60}"
      ;;
    "Mutation Testing Profiler")
      echo "{gmutantVersion:4,gmutantTimebound:60}"
      ;;
    *)
      echo "{}"
      ;;
  esac
}

print_tools() {
  echo "C tools:"
  for tool in "${C_TOOLS[@]}"; do
    echo "  - $tool"
  done

  echo "Java tools:"
  for tool in "${JAVA_TOOLS[@]}"; do
    echo "  - $tool"
  done

  echo "Python tools:"
  for tool in "${PYTHON_TOOLS[@]}"; do
    echo "  - $tool"
  done

  echo "Solidity tools:"
  for tool in "${SOLIDITY_TOOLS[@]}"; do
    echo "  - $tool"
  done
}

run_list_samples() {
  local language="$1"
  local tool="$2"

  docker run \
    --platform "$PLATFORM" \
    --rm \
    --entrypoint python3 \
    "$IMAGE" \
    /opt/trustinn/runner.py list-samples \
      --language "$language" \
      --tool "$tool"
}

run_tool_with_sample() {
  local language="$1"
  local tool="$2"
  local sample_path="$3"
  local params="$4"

  mkdir -p "$RESULTS_DIR"

  docker run \
    --platform "$PLATFORM" \
    --rm \
    -v "$RESULTS_DIR:/results" \
    --entrypoint python3 \
    "$IMAGE" \
    /opt/trustinn/runner.py run-tool \
      --language "$language" \
      --tool "$tool" \
      --sample "$sample_path" \
      --params "$params"
}

run_tool_with_file() {
  local language="$1"
  local tool="$2"
  local file_path="$3"
  local params="$4"

  if [[ ! -f "$file_path" ]]; then
    echo "File not found: $file_path" >&2
    exit 1
  fi

  mkdir -p "$RESULTS_DIR"
  local input_dir
  local input_name
  input_dir="$(cd "$(dirname "$file_path")" && pwd)"
  input_name="$(basename "$file_path")"

  docker run \
    --platform "$PLATFORM" \
    --rm \
    -v "$RESULTS_DIR:/results" \
    -v "$input_dir:/host-input:ro" \
    --entrypoint python3 \
    "$IMAGE" \
    /opt/trustinn/runner.py run-tool \
      --language "$language" \
      --tool "$tool" \
      --sample "/host-input/$input_name" \
      --params "$params"
}

run_all_c() {
  local sample_path="$1"
  local tool

  for tool in "${C_TOOLS[@]}"; do
    echo
    echo "=== Running: $tool ==="
    run_tool_with_sample "c" "$tool" "$sample_path" "$(default_params c "$tool")"
  done
}

main() {
  local cmd="${1:-}"

  if [[ -z "$cmd" ]]; then
    usage
    exit 1
  fi

  case "$cmd" in
    tools)
      print_tools
      ;;

    list-samples)
      local language="${2:-}"
      local tool="${3:-}"
      if [[ -z "$language" || -z "$tool" ]]; then
        usage
        exit 1
      fi
      run_list_samples "$language" "$tool"
      ;;

    run-sample)
      local language="${2:-}"
      local tool="${3:-}"
      local sample_path="${4:-}"
      local params="${5:-}"
      if [[ -z "$language" || -z "$tool" || -z "$sample_path" ]]; then
        usage
        exit 1
      fi
      if [[ -z "$params" ]]; then
        params="$(default_params "$language" "$tool")"
      fi
      run_tool_with_sample "$language" "$tool" "$sample_path" "$params"
      ;;

    run-file)
      local language="${2:-}"
      local tool="${3:-}"
      local file_path="${4:-}"
      local params="${5:-}"
      if [[ -z "$language" || -z "$tool" || -z "$file_path" ]]; then
        usage
        exit 1
      fi
      if [[ -z "$params" ]]; then
        params="$(default_params "$language" "$tool")"
      fi
      run_tool_with_file "$language" "$tool" "$file_path" "$params"
      ;;

    run-all-c)
      local sample_path="${2:-}"
      if [[ -z "$sample_path" ]]; then
        usage
        exit 1
      fi
      run_all_c "$sample_path"
      ;;

    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
