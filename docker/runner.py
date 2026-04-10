#!/usr/bin/env python3
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

BASE_ROOT = Path("/workspace")
RESULTS_ROOT = Path("/results")

TOOL_CONFIG = {
    "c": {
        "Condition Satisfiability Analysis": {"rootDir": "CC-BOUNDED MODEL CHECKER", "script": "cbmc_script.sh"},
        "DSE based Mutation Analyser": {"rootDir": "DSE_MUTATION_ANALYSER", "script": "KLEEMA.sh"},
        "Dynamic Symbolic Execution": {"rootDir": "DYNAMIC_SYMBOLIC_EXECUTION", "script": "KLEE.sh"},
        "Dynamic Symbolic Execution with Pruning": {"rootDir": "DSE_WITH_PRUNING", "script": "tx.sh"},
        "Advance Code Coverage Profiler": {"rootDir": "ADVANCE_CODE_COVERAGE_PROFILER", "script": "main-gProfiler.sh", "sampleDir": "Programs/GCOV"},
        "Mutation Testing Profiler": {"rootDir": "MUTATION_TESTING_PROFILER", "script": "main-gProfiler.sh"},
    },
    "java": {
        "JBMC": {"rootDir": "JAVA", "script": "shellsc.sh"},
    },
    "python": {
        "Condition Coverage Fuzzing": {"rootDir": "PYTHON", "script": "shellpy.sh", "sampleDir": "SAMPLES"},
    },
    "solidity": {
        "VeriSol": {"rootDir": "SOLIDITY", "script": "latest.sh"},
    },
}

EXTENSIONS = {
    "c": [".c"],
    "java": [".java"],
    "python": [".py"],
    "solidity": [".sol"],
}

OUTPUT_DIR_PATTERN = re.compile(r"/(results?|outputs?|reports?|logs?|temp|tmp|tc|klee-out|dist|build)/", re.IGNORECASE)
OUTPUT_NAME_PATTERN = re.compile(r"(results?|outputs?|reports?|logs?|temp|tmp|tc|klee-out|coverage|mutant)", re.IGNORECASE)


def get_tool_config(language: str, tool: str) -> dict:
    by_language = TOOL_CONFIG.get(language, {})
    if tool not in by_language:
        raise RuntimeError(f"Tool config not found for {language}: {tool}")
    return by_language[tool]


def sanitize_segment(value: str) -> str:
    value = (value or "").strip()
    value = re.sub(r"[\\/:*?\"<>|]", "-", value)
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"-+", "-", value)
    return value.strip("-")


def sample_stem(sample_path: str) -> str:
    return Path(sample_path).stem


def resolve_tool_root(config: dict) -> Path:
    return BASE_ROOT / config["rootDir"]


def resolve_sample_root(tool_root: Path, config: dict) -> Path:
    sample_dir = config.get("sampleDir")
    if not sample_dir:
        return tool_root
    candidate = tool_root / sample_dir
    return candidate if candidate.exists() else tool_root


def list_samples(language: str, tool: str) -> None:
    config = get_tool_config(language, tool)
    tool_root = resolve_tool_root(config)
    if not tool_root.exists():
        raise RuntimeError(f"Tool directory not found: {tool_root}")

    allowed = EXTENSIONS.get(language, [])
    root = resolve_sample_root(tool_root, config)

    files = []
    for base in [root, tool_root] if root != tool_root else [root]:
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix.lower() not in allowed:
                continue
            norm = str(p).replace("\\", "/")
            if OUTPUT_DIR_PATTERN.search(norm):
                continue
            files.append({"name": p.name, "path": str(p)})

    seen = set()
    unique = []
    for f in files:
        if f["path"] in seen:
            continue
        seen.add(f["path"])
        unique.append(f)

    sys.stdout.write(json.dumps(unique))


def snapshot_top_level(tool_root: Path) -> dict:
    snap = {}
    for p in tool_root.iterdir():
        try:
            snap[p.name] = p.stat().st_mtime_ns
        except OSError:
            pass
    return snap


def build_args(tool: str, sample_path: str, params: dict) -> list:
    if tool == "Condition Satisfiability Analysis":
        return [sample_path, str(params.get("cbmcBound", ""))]
    if tool == "DSE based Mutation Analyser":
        return [sample_path, str(params.get("kleemaValue", ""))]
    if tool == "Advance Code Coverage Profiler":
        stem = sample_stem(sample_path)
        return [stem, str(params.get("gmcovVersion", "")), str(params.get("gmcovTimebound", ""))]
    if tool == "Mutation Testing Profiler":
        return [sample_path, str(params.get("gmutantVersion", "")), str(params.get("gmutantTimebound", ""))]
    if tool == "VeriSol":
        return [sample_path, str(params.get("solidityMode", ""))]
    return [sample_path]


def copy_candidate(src: Path, dest_dir: Path) -> str:
    dest = dest_dir / src.name
    if src.is_dir():
        if dest.exists():
            shutil.rmtree(dest, ignore_errors=True)
        shutil.copytree(src, dest)
    else:
        shutil.copy2(src, dest)
    return str(dest)


def collect_and_export_results(tool_root: Path, tool: str, sample_path: str, before: dict) -> tuple[str, list]:
    stem = sample_stem(sample_path).lower()
    out_dir = RESULTS_ROOT / sanitize_segment(tool) / sanitize_segment(sample_stem(sample_path))
    out_dir.mkdir(parents=True, exist_ok=True)

    moved = []
    for p in tool_root.iterdir():
        try:
            current = p.stat().st_mtime_ns
        except OSError:
            continue
        previous = before.get(p.name)
        is_new = previous is None
        is_modified = previous is not None and current > previous
        if not (is_new or is_modified):
            continue

        lowered = p.name.lower()
        sample_match = stem and stem in lowered
        output_match = bool(OUTPUT_NAME_PATTERN.search(lowered))
        if not (sample_match or output_match):
            continue

        try:
            moved.append(copy_candidate(p, out_dir))
        except Exception:
            pass

    return str(out_dir), moved


def run_tool(language: str, tool: str, sample_path: str, params_json: str) -> int:
    params = json.loads(params_json) if params_json else {}
    config = get_tool_config(language, tool)
    tool_root = resolve_tool_root(config)
    script_path = tool_root / config["script"]

    if not script_path.exists():
        raise RuntimeError(f"Script not found: {script_path}")

    args = [a for a in build_args(tool, sample_path, params) if str(a).strip()]
    before = snapshot_top_level(tool_root)

    cmd = ["bash", str(script_path), *args]
    proc = subprocess.Popen(cmd, cwd=str(tool_root), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()

    code = proc.wait()
    out_dir, moved = collect_and_export_results(tool_root, tool, sample_path, before)
    if moved:
        sys.stdout.write(f"\nResults moved to: {out_dir}\n")
        sys.stdout.flush()
    return code


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)

    p_list = sub.add_parser("list-samples")
    p_list.add_argument("--language", required=True)
    p_list.add_argument("--tool", required=True)

    p_run = sub.add_parser("run-tool")
    p_run.add_argument("--language", required=True)
    p_run.add_argument("--tool", required=True)
    p_run.add_argument("--sample", required=True)
    p_run.add_argument("--params", default="{}")

    args = parser.parse_args()

    if args.command == "list-samples":
        list_samples(args.language, args.tool)
        return 0
    if args.command == "run-tool":
        return run_tool(args.language, args.tool, args.sample, args.params)
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(f"{exc}\n")
        raise SystemExit(1)
