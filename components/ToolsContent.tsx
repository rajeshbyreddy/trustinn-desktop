"use client";

import { Suspense, lazy, useMemo, useRef, useState, useEffect } from "react";
import { flushSync } from "react-dom";
import type { CSSProperties } from "react";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { FaChartLine, FaChartBar, FaSpinner, FaPython, FaJava } from "react-icons/fa";
import { FaCode } from "react-icons/fa6";
import { SiSolidity } from "react-icons/si";
import { FiEye, FiDownload, FiCopy, FiSquare, FiBarChart2, FiX, FiStopCircle } from "react-icons/fi";
import { Crown, Lock } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/cjs/styles/prism";
import Image from "next/image";
import { SessionCheckModal } from "@/components/SessionInfoModal";

const CodeEditor = lazy(() => import("@/components/CodeEditor"));

type Tab = "c" | "java" | "python" | "solidity";
type InputMode = "file" | "code";
type SoliditySourceMode = "file" | "folder";
type ChartType = "pie" | "bar";

type ChartDatum = { name: string; value: number; fill: string };
type SampleOption = { name: string; path: string };

const DSE_MUTATION_TOOL = "DSE based Mutation Analyser";
const DYNAMIC_SYMBOLIC_TOOL = "Dynamic Symbolic Execution";
const DSE_PRUNING_TOOL = "Dynamic Symbolic Execution with Pruning";
const ADVANCED_COVERAGE_TOOL = "Advance Code Coverage Profiler";
const MUTATION_TESTING_TOOL = "Mutation Testing Profiler";
const JBMC_TOOL = "JBMC";
const PYTHON_FUZZ_TOOL = "Condition Coverage Fuzzing";
const VERISOL_TOOL = "VeriSol";
const MUTATION_REPORT_START = "============Mutation Score Report============";
const MUTATION_REPORT_END = "============Report-Finish====================";
const TRUSTINN_BANNER = "This code is developed by NITMiner Technologies Pvt Ltd.";

type MutationMetrics = {
  alive: number;
  killed: number;
  reached: number;
  dead: number;
  total: number;
  score: number;
};

type DynamicSymbolicMetrics = {
  instrs: number;
  timeSeconds: number;
  icount: number;
  icovPercent: number;
  bcovPercent: number;
  tsolverPercent: number;
};

type AdvancedCoverageMetrics = {
  mcdcFeasible: number;
  mcdcTotal: number;
  mcdcScore: number;
  scmccFeasible: number;
  scmccTotal: number;
  scmccScore: number;
};

type MutationTestingMetrics = {
  killed: number;
  total: number;
  score: number;
};

type JbmcMetrics = {
  failure: number;
  added: number;
  conditionalCoverage: number;
};

type PythonFuzzMetrics = {
  violations: number;
  uniqueCovered: number;
  tracked: number;
  failed: number;
  unique: number;
  passed: number;
  total: number;
  conditionalCoverage: number;
};

type VeriSolMetrics = {
  inserted: number;
  dynamicViolations: number;
  uniqueViolations: number;
  atomicConditions: number;
  coverage: number;
  runtimeSeconds: number;
};

async function navigateToRoute(route: string): Promise<void> {
  const navigateResult = await window.electronAPI?.navigate?.(route);
  if (navigateResult?.ok) return;

  if (route === "/") {
    window.location.href = "./";
    return;
  }

  if (route === "/tools") {
    window.location.href = "./tools/";
    return;
  }

  window.location.href = route;
}

function extractMutationReportBlock(output: string): string {
  const raw = (output || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const start = raw.indexOf(MUTATION_REPORT_START);
  if (start < 0) return "";

  const end = raw.indexOf(MUTATION_REPORT_END, start);
  if (end < 0) {
    return raw.slice(start).trim();
  }

  return raw.slice(start, end + MUTATION_REPORT_END.length).trim();
}

function toMetricNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseMutationMetrics(reportBlock: string): MutationMetrics | null {
  if (!reportBlock) return null;

  const alive = reportBlock.match(/Total number of Alive Mutants\s*=:\s*(\d+)/i)?.[1];
  const killed = reportBlock.match(/Total number of Killed Mutants\s*=:\s*(\d+)/i)?.[1];
  const reached = reportBlock.match(/Total number of Reached Mutants\s*=:\s*(\d+)/i)?.[1];
  const dead = reportBlock.match(/Total number of Dead Mutants\s*=:\s*(\d+)/i)?.[1];
  const total = reportBlock.match(/Total number of Total Mutants\s*=:\s*(\d+)/i)?.[1];
  const score = reportBlock.match(/Mutation Score \(Killed\/Reached\)\s*=:\s*(\d+)%/i)?.[1];

  if (!alive && !killed && !reached && !dead && !total && !score) {
    return null;
  }

  return {
    alive: toMetricNumber(alive),
    killed: toMetricNumber(killed),
    reached: toMetricNumber(reached),
    dead: toMetricNumber(dead),
    total: toMetricNumber(total),
    score: toMetricNumber(score),
  };
}

function mutationMetricsToChartData(metrics: MutationMetrics): ChartDatum[] {
  return [
    { name: "Alive", value: metrics.alive, fill: "#ef4444" },
    { name: "Killed", value: metrics.killed, fill: "#10b981" },
    { name: "Reached", value: metrics.reached, fill: "#3b82f6" },
    { name: "Dead", value: metrics.dead, fill: "#f59e0b" },
    { name: "Total", value: metrics.total, fill: "#8b5cf6" },
  ];
}

function extractDynamicSymbolicSummary(output: string): string {
  const raw = (output || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const banner = raw.includes(TRUSTINN_BANNER) ? TRUSTINN_BANNER : "";
  const tableMatch = raw.match(/-+\n\|\s*Path\s*\|[^\n]*\n-+\n\|[^\n]+\n-+/m);
  if (!tableMatch) {
    return banner;
  }

  return [banner, tableMatch[0]].filter(Boolean).join("\n").trim();
}

function parseDynamicSymbolicMetrics(output: string): DynamicSymbolicMetrics | null {
  const raw = (output || "").replace(/\r\n/g, "\n");
  const rowMatch = raw.match(/\|[^\n]*klee-out-\d+[^\n]*\|/);
  if (!rowMatch) return null;

  const parts = rowMatch[0]
    .split("|")
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length < 7) return null;

  const instrs = Number.parseFloat(parts[1]);
  const timeSeconds = Number.parseFloat(parts[2]);
  const icovPercent = Number.parseFloat(parts[3]);
  const bcovPercent = Number.parseFloat(parts[4]);
  const icount = Number.parseFloat(parts[5]);
  const tsolverPercent = Number.parseFloat(parts[6]);

  if (
    !Number.isFinite(instrs) ||
    !Number.isFinite(timeSeconds) ||
    !Number.isFinite(icount) ||
    !Number.isFinite(icovPercent) ||
    !Number.isFinite(bcovPercent) ||
    !Number.isFinite(tsolverPercent)
  ) {
    return null;
  }

  return { instrs, timeSeconds, icount, icovPercent, bcovPercent, tsolverPercent };
}

function dynamicSymbolicMetricsToChartData(metrics: DynamicSymbolicMetrics): ChartDatum[] {
  return [
    { name: "Instrs", value: metrics.instrs, fill: "#3b82f6" },
    { name: "Time (s)", value: Number(metrics.timeSeconds.toFixed(2)), fill: "#f59e0b" },
    { name: "ICount", value: metrics.icount, fill: "#10b981" },
  ];
}

function extractRegexBlock(output: string, regex: RegExp): string {
  const raw = (output || "").replace(/\r\n/g, "\n");
  return raw.match(regex)?.[0]?.trim() || "";
}

function extractDynamicSymbolicTable(output: string): string {
  return extractRegexBlock(output, /-+\n\|\s*Path\s*\|[^\n]*\n-+\n\|[^\n]+\n-+/m);
}

function extractDsePruningSummary(output: string): string {
  return extractDynamicSymbolicTable(output);
}

function extractAdvancedCoverageSummary(output: string): string {
  const raw = (output || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const banner = raw.includes(TRUSTINN_BANNER) ? TRUSTINN_BANNER : "";
  const mcdc = extractRegexBlock(raw, /============MC\/DC Report============[\s\S]*?============Report-Finish====================/m);
  const scmcc = extractRegexBlock(raw, /============SC-MCC Report============[\s\S]*?============Report-Finish====================/m);
  const doneSection = extractRegexBlock(raw, /Done\. Results.*(?:Results moved.*)?/m);

  // If no reports found, return raw output for debugging
  if (!mcdc && !scmcc) {
    return raw;
  }

  return [banner, mcdc, scmcc, doneSection].filter(Boolean).join("\n").trim();
}

function extractMutationTestingSummary(output: string): string {
  return extractRegexBlock(output, /============Mutation Report====================[\s\S]*?============Report-Finish====================/m);
}

function extractJbmcSummary(output: string): string {
  return extractRegexBlock(output, /-+\nTotal Assertion Failure:\s*\d+[\s\S]*?Conditional Coverage:\s*\d+(?:\.\d+)?%/m);
}

function extractPythonFuzzSummary(output: string): string {
  const summary = extractRegexBlock(output, /=== Assertion Summary ===[\s\S]*?Total tracked assertions:\s*\d+/m);
  const totals = extractRegexBlock(output, /-+\nFailed Assertion:\s*\d+[\s\S]*?Conditional Coverage:\s*\d+(?:\.\d+)?%/m);
  return [summary, totals].filter(Boolean).join("\n").trim();
}

function parseAdvancedCoverageMetrics(output: string): AdvancedCoverageMetrics | null {
  const mcdcFeasible = output.match(/feasible MC\/DC sequences\s*=\s*(\d+)/i)?.[1];
  const mcdcTotal = output.match(/Total no\. of MC\/DC sequences\s*=\s*(\d+)/i)?.[1];
  const mcdcScore = output.match(/MC\/DC Score\s*=\s*(\d+)/i)?.[1];
  const scmccFeasible = output.match(/feasible SC-MCC sequences\s*=\s*(\d+)/i)?.[1];
  const scmccTotal = output.match(/Total no\. of SC-MCC sequences\s*=\s*(\d+)/i)?.[1];
  const scmccScore = output.match(/SC-MCC Score\s*=\s*(\d+)/i)?.[1];

  if (!mcdcFeasible && !mcdcTotal && !mcdcScore && !scmccFeasible && !scmccTotal && !scmccScore) {
    return null;
  }

  return {
    mcdcFeasible: toMetricNumber(mcdcFeasible),
    mcdcTotal: toMetricNumber(mcdcTotal),
    mcdcScore: toMetricNumber(mcdcScore),
    scmccFeasible: toMetricNumber(scmccFeasible),
    scmccTotal: toMetricNumber(scmccTotal),
    scmccScore: toMetricNumber(scmccScore),
  };
}

function advancedCoverageToChartData(metrics: AdvancedCoverageMetrics): ChartDatum[] {
  return [
    { name: "MC/DC Feasible", value: metrics.mcdcFeasible, fill: "#3b82f6" },
    { name: "MC/DC Total", value: metrics.mcdcTotal, fill: "#10b981" },
    { name: "SC-MCC Feasible", value: metrics.scmccFeasible, fill: "#f59e0b" },
    { name: "SC-MCC Total", value: metrics.scmccTotal, fill: "#8b5cf6" },
  ];
}

function parseMutationTestingMetrics(output: string): MutationTestingMetrics | null {
  const killed = output.match(/Total no\.\s*of Killed Mutants\s*=\s*(\d+)/i)?.[1];
  const total = output.match(/Total no\.\s*of Mutants\s*=\s*(\d+)/i)?.[1];
  const score = output.match(/Mutation Score\s*=\s*(\d+)/i)?.[1];

  if (!killed && !total && !score) return null;

  return {
    killed: toMetricNumber(killed),
    total: toMetricNumber(total),
    score: toMetricNumber(score),
  };
}

function mutationTestingToChartData(metrics: MutationTestingMetrics): ChartDatum[] {
  const alive = Math.max(0, metrics.total - metrics.killed);
  return [
    { name: "Killed", value: metrics.killed, fill: "#10b981" },
    { name: "Alive", value: alive, fill: "#ef4444" },
    { name: "Total", value: metrics.total, fill: "#3b82f6" },
  ];
}

function parseJbmcMetrics(output: string): JbmcMetrics | null {
  const failure = output.match(/Total Assertion Failure:\s*(\d+)/i)?.[1];
  const added = output.match(/Total Assertion Added:\s*(\d+)/i)?.[1];
  const conditionalCoverage = output.match(/Conditional Coverage:\s*(\d+(?:\.\d+)?)%/i)?.[1];

  if (!failure && !added && !conditionalCoverage) return null;

  return {
    failure: toMetricNumber(failure),
    added: toMetricNumber(added),
    conditionalCoverage: Number.parseFloat(conditionalCoverage || "0") || 0,
  };
}

function jbmcToChartData(metrics: JbmcMetrics): ChartDatum[] {
  const success = Math.max(0, metrics.added - metrics.failure);
  return [
    { name: "Failure", value: metrics.failure, fill: "#ef4444" },
    { name: "Success", value: success, fill: "#10b981" },
    { name: "Total", value: metrics.added, fill: "#3b82f6" },
  ];
}

function parsePythonFuzzMetrics(output: string): PythonFuzzMetrics | null {
  const violations = output.match(/Total assertion violations:\s*(\d+)/i)?.[1];
  const uniqueCovered = output.match(/Unique assertions covered:\s*(\d+)/i)?.[1];
  const tracked = output.match(/Total tracked assertions:\s*(\d+)/i)?.[1];
  const failed = output.match(/Failed Assertion:\s*(\d+)/i)?.[1];
  const unique = output.match(/Unique Assertions\s*:\s*(\d+)/i)?.[1];
  const passed = output.match(/Passed Assertions\s*:\s*(\d+)/i)?.[1];
  const total = output.match(/Total Assertion\s*:\s*(\d+)/i)?.[1];
  const conditionalCoverage = output.match(/Conditional Coverage:\s*(\d+(?:\.\d+)?)%/i)?.[1];

  if (!violations && !tracked && !failed && !total && !conditionalCoverage) return null;

  return {
    violations: toMetricNumber(violations),
    uniqueCovered: toMetricNumber(uniqueCovered),
    tracked: toMetricNumber(tracked),
    failed: toMetricNumber(failed),
    unique: toMetricNumber(unique),
    passed: toMetricNumber(passed),
    total: toMetricNumber(total),
    conditionalCoverage: Number.parseFloat(conditionalCoverage || "0") || 0,
  };
}

function pythonFuzzToChartData(metrics: PythonFuzzMetrics): ChartDatum[] {
  return [
    { name: "Failed", value: metrics.failed || metrics.violations, fill: "#ef4444" },
    { name: "Passed", value: metrics.passed, fill: "#10b981" },
    { name: "Total", value: metrics.total || metrics.tracked, fill: "#3b82f6" },
    { name: "Unique", value: metrics.unique || metrics.uniqueCovered, fill: "#f59e0b" },
  ];
}

function parseVeriSolMetrics(output: string): VeriSolMetrics | null {
  // Parse the final project summary from VeriSol output
  // Looks for patterns like "Akashic Project total Properties violation detected (dynamic): 22"
  const inserted = output.match(/\btotal\s+assert\s+count:\s*(\d+)/i)?.[1] || output.match(/Properties inserted\s*:\s*(\d+)/i)?.[1];
  const dynamicViolations = output.match(/total\s+properties?\s+violation\s+detected\s*\(\s*dynamic\s*\)\s*:\s*(\d+)/i)?.[1] || output.match(/Properties violation detected \(dynamic\)\s*:\s*(\d+)/i)?.[1];
  const uniqueViolations = output.match(/total\s+(?:violation|properties?)\s+detected\s*\(\s*unique\s*\)\s*:\s*(\d+)/i)?.[1] || output.match(/Properties violation detected \(unique\)\s*:\s*(\d+)/i)?.[1];
  const atomicConditions = output.match(/total\s+atomic\s+condition\s*:\s*(\d+)/i)?.[1] || output.match(/Total atomic condition\s*:\s*(\d+)/i)?.[1];
  const coverage = output.match(/total\s+Condition\s+Coverage\s*%\s*:\s*(\d+(?:\.\d+)?)/i)?.[1] || output.match(/Condition Coverage %\s*:\s*(\d+(?:\.\d+)?)%/i)?.[1];
  const runtimeSeconds = output.match(/total\s+runtime\s+in\s+seconds\s*:\s*(\d+(?:\.\d+)?)/i)?.[1] || output.match(/Total runtime in seconds\s*:\s*(\d+(?:\.\d+)?)/i)?.[1];

  if (!inserted && !dynamicViolations && !uniqueViolations && !atomicConditions && !coverage && !runtimeSeconds) {
    return null;
  }

  return {
    inserted: toMetricNumber(inserted),
    dynamicViolations: toMetricNumber(dynamicViolations),
    uniqueViolations: toMetricNumber(uniqueViolations),
    atomicConditions: toMetricNumber(atomicConditions),
    coverage: Number.parseFloat(coverage || "0") || 0,
    runtimeSeconds: Number.parseFloat(runtimeSeconds || "0") || 0,
  };
}

function veriSolToChartData(metrics: VeriSolMetrics): ChartDatum[] {
  return [
    { name: "Inserted", value: metrics.inserted, fill: "#3b82f6" },
    { name: "Dynamic", value: metrics.dynamicViolations, fill: "#ef4444" },
    { name: "Unique", value: metrics.uniqueViolations, fill: "#10b981" },
    { name: "Atomic", value: metrics.atomicConditions, fill: "#f59e0b" },
  ];
}

/* ─── Modern Design Tokens with Gradients ─────────────────────────────────────────── */
const TOKEN = {
  // Backgrounds
  bg: "#ffffff",
  bgSurface: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
  bgDeep: "#f1f5f9",
  bgGlass: "rgba(255, 255, 255, 0.7)",
  
  // Borders & Shadows
  border: "#e2e8f0",
  borderMd: "#cbd5e1",
  shadow: "0 1px 3px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)",
  shadowMd: "0 4px 6px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.03)",
  shadowLg: "0 10px 15px rgba(0,0,0,0.08), 0 4px 6px rgba(0,0,0,0.04)",
  shadowXl: "0 20px 25px rgba(0,0,0,0.1), 0 10px 10px rgba(0,0,0,0.04)",
  
  // Text Colors
  text: "#1e293b",
  textSub: "#475569",
  textMuted: "#94a3b8",
  
  // Brand Colors with Gradients
  accent: "#6366f1",
  accentGradient: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  green: "#059669",
  greenGradient: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  orange: "#ea580c",
  orangeGradient: "linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)",
  red: "#dc2626",
  redGradient: "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)",
  blue: "#2563eb",
  blueGradient: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
  
  // Terminal
  termBg: "#0f172a",
  termSurface: "#1e293b",
  termBorder: "#334155",
  termGlow: "0 0 20px rgba(99,102,241,0.15)",
  
  // Glassmorphism
  glass: "backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);",
} as const;

/* ─── Language metadata with icons ──────────────────────────── */
const LANG_META: Record<Tab, {
  label: string;
  Icon: React.ComponentType<{ size?: number; style?: CSSProperties }>;
  iconColor: string;
}> = {
  c:        { label: "C",        Icon: FaCode,     iconColor: "#3b82f6" },
  java:     { label: "Java",     Icon: FaJava,     iconColor: "#f59e0b" },
  python:   { label: "Python",   Icon: FaPython,   iconColor: "#22c55e" },
  solidity: { label: "Solidity", Icon: SiSolidity, iconColor: "#8b5cf6" },
};

/* ─── Modern Style Helpers with Advanced Effects ───────────────────────────────────── */
const S = {
  card: {
    background: TOKEN.bg,
    border: `1px solid ${TOKEN.border}`,
    borderRadius: 16,
    padding: "16px 18px",
    boxShadow: TOKEN.shadowMd,
    transition: "all 0.3s ease",
  } as CSSProperties,

  label: {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color: TOKEN.textSub,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    marginBottom: 8,
  } as CSSProperties,

  select: {
    width: "100%",
    border: `2px solid ${TOKEN.border}`,
    borderRadius: 10,
    padding: "10px 14px",
    fontSize: 13,
    fontWeight: 500,
    color: TOKEN.text,
    background: TOKEN.bg,
    outline: "none",
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  } as CSSProperties,

  btn: (bg: string, color = "#fff"): CSSProperties => ({
    background: bg, 
    color,
    border: "none", 
    borderRadius: 10,
    padding: "10px 0", 
    fontSize: 12.5, 
    fontWeight: 700,
    cursor: "pointer", 
    display: "inline-flex",
    alignItems: "center", 
    justifyContent: "center",
    gap: 6, 
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
    boxShadow: TOKEN.shadowMd,
    position: "relative",
    overflow: "hidden",
  }),

  outlineBtn: {
    background: TOKEN.bg, 
    color: TOKEN.text,
    borderRadius: 10, 
    border: `2px solid ${TOKEN.border}`,
    padding: "9px 0", 
    fontSize: 12, 
    fontWeight: 600,
    cursor: "pointer", 
    display: "inline-flex",
    alignItems: "center", 
    justifyContent: "center", 
    gap: 6,
    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  } as CSSProperties,

  paramBox: {
    background: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)", 
    border: "2px solid #bfdbfe",
    borderRadius: 12, 
    padding: "14px 16px", 
    marginTop: 10,
    boxShadow: "inset 0 1px 3px rgba(59,130,246,0.1)",
  } as CSSProperties,

  paramLabel: {
    fontSize: 11.5, 
    color: "#1e40af",
    fontWeight: 700, 
    display: "block", 
    marginBottom: 6,
    letterSpacing: "0.03em",
  } as CSSProperties,

  termBtn: {
    background: "transparent", 
    border: "none",
    color: "#94a3b8", 
    fontSize: 11.5, 
    cursor: "pointer",
    display: "flex", 
    alignItems: "center", 
    gap: 5,
    padding: "5px 10px", 
    borderRadius: 7,
    fontFamily: "inherit", 
    fontWeight: 600,
    transition: "all 0.2s ease",
    whiteSpace: "nowrap" as const,
  } as CSSProperties,
};

/* ─── Analytics Drawer — 30% width, slides right→left ────────── */
function AnalyticsDrawer({
  open, onClose, chartData, chartType, setChartType, visualizationTitle, loading,
  percentageItems,
  onCopyPercentageItem,
}: {
  open: boolean; onClose: () => void;
  chartData: ChartDatum[]; chartType: ChartType;
  setChartType: (t: ChartType) => void;
  visualizationTitle: string; loading: boolean;
  percentageItems: string[];
  onCopyPercentageItem: (item: string) => void;
}) {
  const hasData =
    chartData.length > 0 &&
    !(chartData.length === 1 && chartData[0]?.name === "✅ Execution Complete");

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 50,
          background: "rgba(15,23,42,0.35)",
          backdropFilter: "blur(3px)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.3s ease",
        }}
      />

      {/* Drawer panel with glassmorphism — exactly 30% */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: "30%",
          minWidth: 320,
          maxWidth: 480,
          zIndex: 51,
          background: "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderLeft: "1px solid rgba(226, 232, 240, 0.8)",
          boxShadow: "-12px 0 48px rgba(99,102,241,0.12)",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.4s cubic-bezier(0.16,1,0.3,1)",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Modern drawer header with gradient icon */}
        <div
          style={{
            padding: "20px 24px",
            borderBottom: "1px solid rgba(226, 232, 240, 0.6)",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            flexShrink: 0, 
            background: "linear-gradient(135deg, rgba(248, 250, 252, 0.8) 0%, rgba(241, 245, 249, 0.8) 100%)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 42, 
                height: 42, 
                borderRadius: 12,
                background: TOKEN.accentGradient,
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(99,102,241,0.25)",
              }}
            >
              <FiBarChart2 size={20} color="#fff" />
            </div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: TOKEN.text, letterSpacing: "-0.01em" }}>
                {visualizationTitle || "Analytics"}
              </div>
              <div style={{ fontSize: 12, color: TOKEN.textMuted, marginTop: 2, fontWeight: 500 }}>
                Execution visualization
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 36, 
              height: 36, 
              borderRadius: 10,
              background: "rgba(248, 250, 252, 0.5)", 
              border: "1px solid rgba(226, 232, 240, 0.6)",
              color: TOKEN.textSub, 
              cursor: "pointer",
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
              e.currentTarget.style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(248, 250, 252, 0.5)";
              e.currentTarget.style.color = TOKEN.textSub;
            }}
          >
            <FiX size={18} />
          </button>
        </div>

        {/* Drawer body */}
        <div
          style={{
            flex: 1, overflowY: "auto",
            padding: "14px 16px",
            display: "flex", flexDirection: "column", gap: 12,
          }}
        >
          {!hasData ? (
            <div
              style={{
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                flex: 1, gap: 10, paddingTop: 60,
              }}
            >
              <FiBarChart2 size={34} color={TOKEN.textMuted} />
              <div style={{ fontSize: 13, fontWeight: 600, color: TOKEN.text }}>No data yet</div>
              <div style={{ fontSize: 11.5, color: TOKEN.textMuted, textAlign: "center", lineHeight: 1.5 }}>
                Execute a tool first, then view analytics here.
              </div>
            </div>
          ) : (
            <>
              {/* Chart type toggle */}
              <div
                style={{
                  display: "flex", gap: 3,
                  background: TOKEN.bgDeep, borderRadius: 9,
                  padding: 3, border: `1px solid ${TOKEN.border}`,
                }}
              >
                {(["pie", "bar"] as ChartType[]).map((t) => (
                  <button
                    key={t}
                    onClick={() => setChartType(t)}
                    style={{
                      flex: 1, padding: "6px 0", borderRadius: 7,
                      background: chartType === t ? TOKEN.bg : "transparent",
                      border: chartType === t ? `1px solid ${TOKEN.border}` : "1px solid transparent",
                      color: chartType === t ? TOKEN.accent : TOKEN.textMuted,
                      fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                      transition: "all 0.15s",
                    }}
                  >
                    {t === "pie"
                      ? <><FaChartLine size={11} /> Pie</>
                      : <><FaChartBar size={11} /> Bar</>}
                  </button>
                ))}
              </div>

              {/* Chart */}
              <div style={{ ...S.card, padding: "12px 8px" }}>
                <div
                  style={{
                    fontSize: 9.5, fontWeight: 700, color: TOKEN.textSub,
                    marginBottom: 8, letterSpacing: "0.07em", textTransform: "uppercase",
                    display: "flex", alignItems: "center", gap: 5,
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: TOKEN.accent, display: "inline-block" }} />
                  {visualizationTitle || "Results"}
                </div>
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    {chartType === "pie" ? (
                      <PieChart>
                        <Pie
                          data={chartData} cx="50%" cy="50%"
                          outerRadius={75} dataKey="value"
                          label={({ name, value }) => `${name}: ${value}`}
                          labelLine={{ stroke: "#d1d5db", strokeWidth: 1 }}
                        >
                          {chartData.map((entry, i) => (
                            <Cell key={`${entry.name}-${i}`} fill={entry.fill} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ background: TOKEN.bg, border: `1px solid ${TOKEN.border}`, borderRadius: 8, fontSize: 11 }} />
                        <Legend iconType="circle" wrapperStyle={{ fontSize: 10.5, color: TOKEN.textSub }} />
                      </PieChart>
                    ) : (
                      <BarChart data={chartData} barSize={16} margin={{ top: 10, right: 10, left: 10, bottom: 36 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={TOKEN.bgDeep} />
                        <XAxis dataKey="name" tick={{ fill: TOKEN.textSub, fontSize: 10 }} axisLine={{ stroke: TOKEN.borderMd }} tickLine={false} angle={-35} textAnchor="end" height={60} interval={0} />
                        <YAxis tick={{ fill: TOKEN.textSub, fontSize: 10 }} axisLine={{ stroke: TOKEN.borderMd }} tickLine={false} width={36} />
                        <Tooltip contentStyle={{ background: TOKEN.bg, border: `1px solid ${TOKEN.border}`, borderRadius: 8, fontSize: 11 }} />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, i) => (
                            <Cell key={`${entry.name}-${i}`} fill={entry.fill} />
                          ))}
                        </Bar>
                      </BarChart>
                    )}
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Stat cards */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                {chartData.map((d) => (
                  <div
                    key={d.name}
                    style={{
                      background: TOKEN.bgSurface, border: `1px solid ${TOKEN.border}`,
                      borderRadius: 9, padding: "9px 11px",
                      borderLeft: `3px solid ${d.fill}`,
                    }}
                  >
                    <div style={{ fontSize: 10, color: TOKEN.textMuted, marginBottom: 3 }}>{d.name}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, color: TOKEN.text }}>{d.value}</div>
                  </div>
                ))}
              </div>

              {/* Download */}
              {percentageItems.length > 0 && (
                <div style={{ display: "grid", gap: 6 }}>
                  {percentageItems.map((item) => (
                    <button
                      key={item}
                      onClick={() => onCopyPercentageItem(item)}
                      style={{
                        ...S.btn("#0891b2"),
                        width: "100%", padding: "8px 10px",
                        fontSize: 11.5,
                        textAlign: "left",
                        justifyContent: "flex-start",
                        whiteSpace: "normal",
                        lineHeight: 1.35,
                      }}
                      title={item}
                    >
                      {`CTC: ${item}`}
                    </button>
                  ))}
                </div>
              )}

              <button
                disabled={loading}
                style={{
                  ...S.btn(loading ? TOKEN.bgDeep : TOKEN.accent),
                  color: loading ? TOKEN.textMuted : "#fff",
                  width: "100%", padding: "9px 0",
                  fontSize: 12, opacity: loading ? 0.7 : 1,
                }}
              >
                {loading
                  ? <><FaSpinner style={{ animation: "spin 1s linear infinite" }} size={12} /> Preparing…</>
                  : <><FiDownload size={12} /> Download Chart</>}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* ─── Sample Picker Modal ────────────────────────────────────── */
function SamplePickerModal({ open, title, samples, onClose, onSelect }: {
  open: boolean; title: string; samples: SampleOption[];
  onClose: () => void; onSelect: (s: SampleOption) => void;
}) {
  if (!open) return null;
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 60,
        background: "rgba(15,23,42,0.6)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        animation: "fadeIn 0.2s ease-out",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 95vw)", maxHeight: "80vh",
          background: "rgba(255, 255, 255, 0.98)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderRadius: 20,
          border: "1px solid rgba(226, 232, 240, 0.8)",
          boxShadow: TOKEN.shadowXl,
          overflow: "hidden", display: "flex", flexDirection: "column",
          animation: "fadeIn 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div
          style={{
            padding: "18px 24px", 
            borderBottom: "1px solid rgba(226, 232, 240, 0.6)",
            background: "rgba(248, 250, 252, 0.8)",
            fontSize: 16, 
            fontWeight: 700, 
            color: TOKEN.text,
            display: "flex", 
            justifyContent: "space-between", 
            alignItems: "center",
          }}
        >
          {title}
          <button
            onClick={onClose}
            style={{
              width: 32, 
              height: 32, 
              borderRadius: 8,
              background: "rgba(248, 250, 252, 0.5)", 
              border: "1px solid rgba(226, 232, 240, 0.6)",
              color: TOKEN.textSub, 
              cursor: "pointer",
              display: "flex", 
              alignItems: "center", 
              justifyContent: "center",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
              e.currentTarget.style.color = "#ef4444";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "rgba(248, 250, 252, 0.5)";
              e.currentTarget.style.color = TOKEN.textSub;
            }}
          >
            <FiX size={16} />
          </button>
        </div>
        <div style={{ padding: 16, overflowY: "auto", flex: 1 }}>
          {samples.length === 0 ? (
            <div style={{ 
              fontSize: 13, 
              color: TOKEN.textMuted, 
              padding: "24px 16px", 
              textAlign: "center",
              background: "rgba(248, 250, 252, 0.5)",
              borderRadius: 12,
            }}>
              No samples available yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {samples.map((s) => (
                <button
                  key={s.path}
                  onClick={() => onSelect(s)}
                  style={{
                    width: "100%", 
                    textAlign: "left",
                    border: "1px solid rgba(226, 232, 240, 0.8)", 
                    borderRadius: 12,
                    background: "rgba(255, 255, 255, 0.7)", 
                    padding: "14px 16px",
                    cursor: "pointer", 
                    fontSize: 13, 
                    fontWeight: 600,
                    color: TOKEN.text,
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = TOKEN.accentGradient;
                    e.currentTarget.style.color = "#fff";
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = TOKEN.shadowMd;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.7)";
                    e.currentTarget.style.color = TOKEN.text;
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
                  }}
                >
                  📄 {s.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────────────── */
export default function ToolsContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [trialsExhausted, setTrialsExhausted] = useState(false);
  const [showNoTrialsModal, setShowNoTrialsModal] = useState(false);
  const [isRefreshingTrial, setIsRefreshingTrial] = useState(false);
  
  // Docker image setup state
  const [showImageSetupModal, setShowImageSetupModal] = useState(false);
  const [imageSetupLoading, setImageSetupLoading] = useState(false);
  const [imageSetupStatus, setImageSetupStatus] = useState("Checking tool configuration...");
  const [imageSetupProgress, setImageSetupProgress] = useState(0);
  const [isStoppingSetup, setIsStoppingSetup] = useState(false);
  const DOCKER_IMAGE_NAME = "rajeshbyreddy95/trustinn-tools:19.0.0";
  
  
  // Validate token and check trial/premium eligibility (REAL-TIME from backend)
  const validateTokenAndCheckEligibility = async (type: Tab, onError: (msg: string) => void): Promise<boolean> => {
    try {
      const token = sessionStorage.getItem("trustinn_token");
      if (!token) {
        onError("❌ No valid session. Please login again.");
        return false;
      }

      // ✅ Add cache-busting parameters and headers to force fresh data from backend
      const timestamp = Date.now();
      
      // ✅ Determine API endpoint based on environment
      // In packaged Electron app (file:// protocol), call NitMiner API directly
      // In dev mode (localhost), can use local proxy
      let apiUrl = `/api/auth/validate-token?t=${timestamp}`;
      
      if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
        // Packaged Electron app - call NitMiner API directly
        const NITMINER_API = process.env.REACT_APP_NITMINER_API || 'https://api.nitminer.com';
        apiUrl = `${NITMINER_API}/api/auth/validate-token?t=${timestamp}`;
        console.log(`[EXEC] Production mode - calling NitMiner directly:`, apiUrl);
      } else {
        console.log(`[EXEC] Dev mode - calling local API`);
      }

      console.log(`[EXEC] Fetching fresh token validation (timestamp: ${timestamp})...`);

      // ✅ Call endpoint to get fresh data from backend
      const response = await fetch(apiUrl, {
        method: "GET",
        cache: "no-store",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
          "X-Requested-At": String(timestamp),
        },
      });

      if (!response.ok) {
        console.error("[EXEC] Token validation failed, status:", response.status);
        onError("❌ Token validation failed. Please login again.");
        return false;
      }

      const data = await response.json();
      console.log("[EXEC] Token validation response:", data);

      if (!data.success || !data.data) {
        console.error("[EXEC] Invalid response structure:", data);
        onError("❌ Unable to validate your account. Please try again.");
        return false;
      }

      const trialCount = Number(data.data?.trialCount ?? 0);
      const isPremium = data.data?.isPremium === true || data.data?.isPremium === "true";
      const safeTrialCount = Number.isFinite(trialCount) ? trialCount : 0;
      console.log(`[EXEC] User eligibility - Trials: ${safeTrialCount}, Premium: ${isPremium}`);

      // Update frontend state from backend truth
      sessionStorage.setItem("trustinn_user", JSON.stringify(data.data));
      setUserData(data.data);
      console.log("[EXEC] Updated sessionStorage with fresh user data");

      // ✅ CRITICAL: If user has 0 trials and not premium, block ALL operations
      if (safeTrialCount <= 0 && !isPremium) {
        console.log("[EXEC] User not eligible - no trials and not premium");
        setTrialsExhausted(true);  // ← Update UI immediately
        setShowNoTrialsModal(true);  // ← Show modal card
        
        // Remove Docker image immediately if user has exhausted trials
        try {
          console.log("[EXEC] Removing Docker image due to trial exhaustion");
          const removeResult = await window.electronAPI?.removeDockerImage?.(DOCKER_IMAGE_NAME);
          if (removeResult?.ok) {
            console.log("[EXEC] Docker image removed successfully");
          }
        } catch (error) {
          console.warn("[EXEC] Failed to remove Docker image:", error);
        }
        
        return false;
      }

      // User can execute if they have trials OR are premium
      if (safeTrialCount > 0 || isPremium) {
        console.log("[EXEC] User eligible to execute");
        setTrialsExhausted(false);
        setShowNoTrialsModal(false);  // ← Also clear the modal
        return true;
      } else {
        console.log("[EXEC] User not eligible - no trials and not premium");
        onError("❌ You don't have any trials or premium access. Please upgrade your plan.");
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[EXEC] Token validation error:", error);
      onError(`❌ Unable to validate your session: ${errorMsg}`);
      return false;
    }
  };

  // Refresh trial status manually
  const refreshTrialStatus = async () => {
    if (isRefreshingTrial) return;
    
    setIsRefreshingTrial(true);
    try {
      const isEligible = await validateTokenAndCheckEligibility(currentTab, () => {});
      if (isEligible) {
        console.log("[REFRESH] ✅ Trial status refreshed - user is eligible");
        mockAppendOutput(currentTab, "✅ Trial status refreshed successfully!");
        setShowNoTrialsModal(false);
        setTrialsExhausted(false);
      } else {
        console.log("[REFRESH] ⚠️ Trial status refreshed - user not eligible");
        mockAppendOutput(currentTab, "⚠️ Your trial eligibility remains unavailable.");
      }
    } catch (error) {
      console.error("[REFRESH] Error refreshing trial status:", error);
      mockAppendOutput(currentTab, "❌ Failed to refresh trial status. Please try again.");
    } finally {
      setIsRefreshingTrial(false);
    }
  };

  // Check and pull Docker image if needed
  const ensureDockerImageExists = async (): Promise<boolean> => {
    try {
      setShowImageSetupModal(true);
      setImageSetupLoading(true);
      setIsStoppingSetup(false);
      setImageSetupProgress(0);
      setImageSetupStatus("Checking tool configuration...");

      // Check if image exists
      console.log("[DOCKER] Checking if image exists...");
      const checkResult = await window.electronAPI?.checkDockerImageExists?.(DOCKER_IMAGE_NAME);
      
      if (!checkResult || !checkResult.ok) {
        console.error("[DOCKER] Failed to check image:", checkResult?.error);
        setImageSetupStatus("Error checking configuration");
        setImageSetupLoading(false);
        return false;
      }

      if (checkResult.exists) {
        console.log("[DOCKER] Image already exists");
        setImageSetupProgress(100);
        setImageSetupStatus("Configuration ready!");
        setImageSetupLoading(false);
        setTimeout(() => setShowImageSetupModal(false), 800);
        return true;
      }

      // Image doesn't exist, pull it
      console.log("[DOCKER] Image not found, pulling...");
      setImageSetupProgress(5);
      setImageSetupStatus("Downloading tool configuration...");
      
      const pullResult = await window.electronAPI?.pullDockerImage?.(DOCKER_IMAGE_NAME);
      
      if (!pullResult || !pullResult.ok) {
        console.error("[DOCKER] Failed to pull image:", pullResult?.error);
        if (pullResult?.error?.toLowerCase().includes("cancelled")) {
          setImageSetupStatus("Setup cancelled by user");
        } else {
          setImageSetupStatus(`Error: ${pullResult?.error || "Failed to download"}`);
        }
        setImageSetupLoading(false);
        return false;
      }

      console.log("[DOCKER] Image pulled successfully");
      setImageSetupProgress(100);
      setImageSetupStatus("Configuration ready!");
      setImageSetupLoading(false);
      setTimeout(() => setShowImageSetupModal(false), 800);
      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[DOCKER] Error ensuring image exists:", error);
      setImageSetupStatus(`Error: ${errorMsg}`);
      setImageSetupLoading(false);
      return false;
    }
  };

  const stopImageSetup = async () => {
    if (!imageSetupLoading || isStoppingSetup) return;
    setIsStoppingSetup(true);
    setImageSetupStatus("Stopping setup...");
    try {
      const result = await window.electronAPI?.stopDockerPullImage?.();
      if (result?.ok) {
        setImageSetupLoading(false);
        setImageSetupProgress(0);
        setImageSetupStatus("Setup cancelled by user");
        setTimeout(() => setShowImageSetupModal(false), 500);
      } else {
        setImageSetupStatus(`Error: ${result?.error || "Unable to stop setup"}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unable to stop setup";
      setImageSetupStatus(`Error: ${errorMsg}`);
    } finally {
      setIsStoppingSetup(false);
    }
  };

  // Deduct one trial after successful execution
  const deductTrialAndCheckStatus = async (): Promise<boolean> => {
    try {
      const token = sessionStorage.getItem("trustinn_token");
      if (!token) {
        console.warn("[TRIAL] No token available for trial deduction");
        return false;
      }

      console.log("[TRIAL] Deducting 1 trial from user account");
      
      // ✅ Determine API endpoint based on environment
      // In packaged Electron app (file:// protocol), call NitMiner API directly
      // In dev mode (localhost), can use local proxy
      let consumeUrl = "/api/auth/consume-trial";
      if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
        // Packaged Electron app - call NitMiner API directly
        const NITMINER_API = process.env.REACT_APP_NITMINER_API || 'https://api.nitminer.com';
        consumeUrl = `${NITMINER_API}/api/auth/consume-trial`;
        console.log(`[TRIAL] Production mode - calling NitMiner directly:`, consumeUrl);
      } else {
        console.log(`[TRIAL] Dev mode - calling local API`);
      }

      const response = await fetch(consumeUrl, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });

      if (!response.ok) {
        console.error("[TRIAL] Trial deduction failed, status:", response.status);
        return false;
      }

      const data = await response.json();
      console.log("[TRIAL] Trial deduction response:", data);

      if (!data.success || !data.data) {
        console.error("[TRIAL] Invalid response structure:", data);
        return false;
      }

      const trialCount = Number(data.data?.trialCount ?? 0);
      const isPremium = data.data?.isPremium === true || data.data?.isPremium === "true";
      const safeTrialCount = Number.isFinite(trialCount) ? trialCount : 0;
      console.log(`[TRIAL] After deduction - Trials: ${safeTrialCount}, Premium: ${isPremium}`);

      // Update frontend state from backend truth
      sessionStorage.setItem("trustinn_user", JSON.stringify(data.data));
      setUserData(data.data);

      // If trials reached 0 and user is not premium, remove Docker image
      if (safeTrialCount <= 0 && !isPremium) {
        console.log("[TRIAL] Trials exhausted and user not premium. Removing Docker image...");
        setTrialsExhausted(true);  // ← Update UI banner
        setShowNoTrialsModal(true);  // ← Show modal card
        try {
          const removeResult = await window.electronAPI?.removeDockerImage?.(DOCKER_IMAGE_NAME);
          if (removeResult?.ok) {
            console.log("[TRIAL] Docker image removed successfully");
          } else {
            console.warn("[TRIAL] Failed to remove Docker image:", removeResult?.error);
          }
        } catch (error) {
          console.warn("[TRIAL] Error removing Docker image:", error);
          // Don't fail the execution if image removal fails
        }
      }

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error("[TRIAL] Trial deduction error:", error);
      // Don't fail execution if trial deduction fails, it's a background operation
      return false;
    }
  };
  
  
  const [currentTab, setCurrentTab] = useState<Tab>("c");
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [cTool, setCTool] = useState("");
  const [javaTool, setJavaTool] = useState("");
  const [pythonTool, setPythonTool] = useState("");
  const [solidityTool, setSolidityTool] = useState("");
  const [cbmcBound, setCbmcBound] = useState("5");
  const [kleemaValue, setKleemaValue] = useState("1");
  const [gmcovVersion, setGmcovVersion] = useState("4");
  const [gmutantVersion, setGmutantVersion] = useState("4");
  const [gmcovTimebound, setGmcovTimebound] = useState("1200");
  const [gmutantTimebound, setGmutantTimebound] = useState("60");
  const [solidityMode, setSolidityMode] = useState("bmc");
  const [sampleOptions, setSampleOptions] = useState<Record<Tab, SampleOption[]>>({
    c: [], java: [], python: [], solidity: [],
  });
  const [selectedSamplePath, setSelectedSamplePath] = useState<Record<Tab, string>>({
    c: "", java: "", python: "", solidity: "",
  });
  const [selectedLocalFilePath, setSelectedLocalFilePath] = useState<Record<Tab, string>>({
    c: "", java: "", python: "", solidity: "",
  });
  const [selectedLocalFolderPath, setSelectedLocalFolderPath] = useState("");
  const [soliditySourceMode, setSoliditySourceMode] = useState<SoliditySourceMode>("file");
  const [isLoadingSamples, setIsLoadingSamples] = useState(false);
  const [sampleModalOpen, setSampleModalOpen] = useState(false);
  const [fileViewerOpen, setFileViewerOpen] = useState(false);
  const [fileViewerContent, setFileViewerContent] = useState("");
  const [fileViewerLanguage, setFileViewerLanguage] = useState<Tab>("c");
  const [tempFilePaths, setTempFilePaths] = useState<Record<Tab, string>>({
    c: "", java: "", python: "", solidity: "",
  });
  const [userCode, setUserCode] = useState<Record<Tab, string>>({
    c: '#include <stdio.h>\n\nint main() {\n    printf("Hello, World!\\n");\n    return 0;\n}',
    java: 'public class program {\n    public static void main(String[] args) {\n        System.out.println("Hello, World!");\n    }\n}',
    python: 'print("Hello, World!")',
    solidity: '// SPDX-License-Identifier: MIT\npragma solidity ^0.8.0;\n\ncontract HelloWorld {\n    function greet() public pure returns (string memory) {\n        return "Hello, World!";\n    }\n}',
  });
  const [terminalOutputs, setTerminalOutputs] = useState<Record<Tab, string>>({
    c: "", java: "", python: "", solidity: "",
  });
  const [loading, setLoading] = useState(false);
  const [isCompiling, setIsCompiling] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chartData, setChartData] = useState<ChartDatum[]>([]);
  const [chartType, setChartType] = useState<ChartType>("pie");
  const [visualizationTitle, setVisualizationTitle] = useState("Execution Metrics");
  const [percentageItems, setPercentageItems] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const timerIdsRef = useRef<(NodeJS.Timeout | ReturnType<typeof setTimeout>)[]>([]);
  const stopRequestedRef = useRef<boolean>(false);
  const pendingPromisesRef = useRef<Array<{
    resolve: (v: any) => void;
    reject: (e: any) => void;
  }>>([]);

  const logoSrc = useMemo(() => {
    if (typeof window === "undefined") return "/logo.png";
    if (window.location.protocol === "file:") return "../logo.png";
    return "/logo.png";
  }, []);

  // ── Auth check on mount ──────────────────────────────────
  useEffect(() => {
    const checkAuth = async () => {
      if (typeof window === "undefined") {
        setAuthLoading(false);
        return;
      }

      try {
        // Check if session exists in sessionStorage (from NoAccessError login)
        const token = sessionStorage.getItem("trustinn_token");
        const userId = sessionStorage.getItem("trustinn_user_id");
        const userStr = sessionStorage.getItem("trustinn_user");

        if (!token || !userId) {
          console.log("[ToolsContent] No session found");
          setIsAuthenticated(false);
          setAuthLoading(false);
          return;
        }

        // Check if token is expired
        const expiryStr = sessionStorage.getItem("token_expires");
        if (expiryStr) {
          const expiryTime = new Date(expiryStr).getTime();
          if (expiryTime <= Date.now()) {
            console.log("[ToolsContent] Token expired");
            sessionStorage.removeItem("trustinn_token");
            sessionStorage.removeItem("trustinn_user_id");
            sessionStorage.removeItem("token_expires");
            sessionStorage.removeItem("trustinn_user");
            setIsAuthenticated(false);
            setAuthLoading(false);
            return;
          }
        }

        // Hydrate from session only as a temporary shell value.
        if (userStr) {
          try {
            const parsedUser = JSON.parse(userStr);
            setUserData(parsedUser);
          } catch (e) {
            console.error("[ToolsContent] Failed to parse user data:", e);
          }
        }

        // Token exists, but live backend validation is the only source of truth
        const isEligible = await validateTokenAndCheckEligibility("c", () => {});
        setIsAuthenticated(true);
        console.log("[ToolsContent] Session validated against backend");

        if (!isEligible) {
          console.log("[ToolsContent] Setting trialsExhausted to true");
          setTrialsExhausted(true);
        } else {
          console.log("[ToolsContent] User is eligible, clearing exhausted state");
          setTrialsExhausted(false);
          setShowNoTrialsModal(false);
        }
      } catch (error) {
        console.error("[ToolsContent] Auth check error:", error);
        setIsAuthenticated(false);
      } finally {
        setAuthLoading(false);
      }
    };

    void checkAuth();
  }, []);

  // Setup progress listener
  useEffect(() => {
    window.electronAPI?.onSetupProgress?.((progress: number) => {
      console.log(`[SETUP] Progress: ${progress}%`);
      setImageSetupProgress(progress);
    });
  }, []);

  // Live code output listener
  useEffect(() => {
    const handleLiveOutput = (payload: { language: string; stream: string; data: string }) => {
      const { language, data } = payload;
      const validTabs: Tab[] = ["c", "java", "python", "solidity"];
      
      // CRITICAL: Don't accept output if process was stopped by user
      // This prevents infinite state updates that freeze the UI
      if (stopRequestedRef.current) {
        console.log("[OUTPUT] Ignoring output after stop requested");
        return;
      }
      
      if (validTabs.includes(language as Tab)) {
        setTerminalOutputs((prev) => ({
          ...prev,
          [language as Tab]: (prev[language as Tab] || "") + data
        }));
      }
    };

    window.electronAPI?.onCodeOutputLive(handleLiveOutput);

    return () => {
      // Note: Electron IPC listeners are persistent, no need to remove
    };
  }, []);

  const getFileName = (v: string) =>
    v ? v.replace(/\\\\/g, "/").split("/").pop() || v : "";

  const currentTool = useMemo(() => {
    if (currentTab === "c") return cTool;
    if (currentTab === "java") return javaTool;
    if (currentTab === "python") return pythonTool;
    return solidityTool;
  }, [currentTab, cTool, javaTool, pythonTool, solidityTool]);

  // Auto-scroll terminal to bottom when output changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutputs[currentTab]]);

  const cParams = useMemo(() => {
    switch (cTool) {
      case "Condition Satisfiability Analysis": return `{cbmcBound:${cbmcBound || "10"}}`;
      case "DSE based Mutation Analyser": return `{kleemaValue:${kleemaValue || "3"}}`;
      case "Advance Code Coverage Profiler": return `{gmcovVersion:${gmcovVersion || "4"},gmcovTimebound:${gmcovTimebound || "60"}}`;
      case "Mutation Testing Profiler": return `{gmutantVersion:${gmutantVersion || "4"},gmutantTimebound:${gmutantTimebound || "60"}}`;
      default: return "{}";
    }
  }, [cTool, cbmcBound, kleemaValue, gmcovVersion, gmcovTimebound, gmutantVersion, gmutantTimebound]);

  const solidityParams = useMemo(() => `{solidityMode:${solidityMode || "bmc"}}`, [solidityMode]);

  const mockAppendOutput = (tab: Tab, msg: string) => {
    setTerminalOutputs((prev) => ({ ...prev, [tab]: prev[tab] + msg + "\n" }));
    // Auto-scroll is now handled by useEffect, no need for setTimeout
  };

  const stopExecution = (reason?: string) => {
    // Stop immediately - set states first, then clean up
    const wasRunning = loading || isCompiling;
    
    console.log("[UI-STOP] Stop called - wasRunning:", wasRunning, "reason:", reason, "loading:", loading, "isCompiling:", isCompiling, "pendingCount:", pendingPromisesRef.current.length);
    
    // Set abort flag FIRST
    stopRequestedRef.current = true;
    
    // Reject any pending promises from compilation/execution
    pendingPromisesRef.current.forEach(({ reject }) => {
      try {
        reject(new Error("Stop requested by user"));
      } catch (e) {
        console.warn("[UI-STOP] reject failed:", e);
      }
    });
    pendingPromisesRef.current = [];
    
    // Clear all pending timers - this is critical
    timerIdsRef.current.forEach(id => {
      try {
        clearTimeout(id);
      } catch (e) {
        // Ignore cleanup errors
      }
    });
    timerIdsRef.current = [];
    
    // Use flushSync to ensure CRITICAL state updates happen immediately on the DOM
    // This prevents the UI from freezing when stopping execution
    flushSync(() => {
      setLoading(false);
      setIsCompiling(false);
      setPercentageItems([]);
    });
    
    // Add output message SEPARATELY (outside of flushSync) to avoid nested state conflicts
    if (wasRunning && reason) {
      mockAppendOutput(currentTab, `🛑 ${reason}`);
    } else if (!wasRunning) {
      mockAppendOutput(currentTab, `ℹ️ No process running to stop`);
    }
    
    console.log("[UI-STOP] State flushed - UI should be responsive now");
    
    // Now try to stop the backend process with timeout - don't let it hang the UI
    if (window.electronAPI?.stopRun) {
      try {
        // Set a very short timeout so we don't wait forever for the backend
        const stopPromise = window.electronAPI.stopRun();
        const stopTimeout = new Promise((resolve) => 
          setTimeout(() => {
            console.warn("[UI-STOP] Backend stop timeout - ignoring");
            resolve({ ok: false, stopped: false, message: "timeout" });
          }, 1000)
        );
        
        // Don't await - just fire and forget
        Promise.race([stopPromise, stopTimeout]).then((result: any) => {
          console.log("[UI-STOP] Backend stop result:", result);
          if (result.ok && result.stopped) {
            console.log("[UI-STOP] Process killed successfully");
          } else {
            console.warn("[UI-STOP] Stop request did not terminate process immediately", result);
          }
        }).catch((error) => {
          console.error("[UI-STOP] Failed to stop backend:", error);
        });
      } catch (error) { 
        console.error("[UI-STOP] Failed to stop backend:", error);
      }
    } else {
      console.warn("[UI-STOP] electronAPI.stopRun not available");
    }
    
    console.log("[UI-STOP] Stop execution complete - UI should be responsive now");
    
    // Reset the stop flag after longer delay to ensure backend output stops
    // This prevents stale output events from updating state after stop
    setTimeout(() => {
      stopRequestedRef.current = false;
      console.log("[UI-STOP] stopRequestedRef reset to false - new execution available");
    }, 500);
  };

  const switchTab = (tabId: Tab) => {
    stopExecution("Language switched");
    setTerminalOutputs({ c: "", java: "", python: "", solidity: "" });
    setChartData([]);
    setPercentageItems([]);
    setInputMode("file");
    setCurrentTab(tabId);
    setSampleModalOpen(false);
  };

  const handleToolChange = (value: string) => {
    stopExecution("Tool switched");
    setTerminalOutputs({ c: "", java: "", python: "", solidity: "" });
    setChartData([]);
    setPercentageItems([]);
    if (currentTab === "c") setCTool(value);
    else if (currentTab === "java") setJavaTool(value);
    else if (currentTab === "python") setPythonTool(value);
    else setSolidityTool(value);
    setSelectedLocalFilePath((prev) => ({ ...prev, [currentTab]: "" }));
    setSelectedSamplePath((prev) => ({ ...prev, [currentTab]: "" }));
    if (currentTab === "solidity") {
      setSelectedLocalFolderPath("");
      setSoliditySourceMode("file");
    }
  };

  const simulateRunOutput = (tab: Tab, code: string) => {
    if (tab === "java") {
      const cn = code.match(/class\s+([A-Za-z_]\w*)/)?.[1] || "Main";
      return [`[Run] java ${cn}`, "Hello, World!"];
    }
    if (tab === "python") return ["[Run] python program.py", "Hello, World!"];
    if (tab === "c") return ["[Run] ./a.out", "Hello, World!"];
    return ["[Run] solidity execution simulation", "Execution completed"];
  };

  const loadSamplesForTool = async () => {
    setTerminalOutputs((prev) => ({ ...prev, [currentTab]: "" }));

    // ✅ CRITICAL: Validate trial/premium eligibility BEFORE ANY other operation
    console.log("[SAMPLES] Validating eligibility before loading samples...");
    const isEligible = await validateTokenAndCheckEligibility(currentTab, (msg: string) => {
      console.log("[SAMPLES] Eligibility check error message:", msg);
      mockAppendOutput(currentTab, msg);
    });
    
    if (!isEligible) {
      console.log("[SAMPLES] User not eligible - aborting sample load");
      console.log("[SAMPLES] trialsExhausted state should be true, showNoTrialsModal should be true");
      return;  // ← Exit here, don't proceed to Docker setup
    }

    console.log("[SAMPLES] User is eligible, proceeding with sample load");

    if (!currentTool) {
      mockAppendOutput(currentTab, `❌ Select a ${currentTab.toUpperCase()} tool first.`);
      return;
    }

    // ✅ Only setup Docker if user IS eligible
    console.log("[SAMPLES] Ensuring Docker image exists for eligible user...");
    const imageReady = await ensureDockerImageExists();
    if (!imageReady) {
      mockAppendOutput(currentTab, `❌ Failed to prepare tools. Please try again.`);
      return;
    }

    setIsLoadingSamples(true);
    mockAppendOutput(currentTab, `[EXEC] Loading samples for ${currentTool}...`);
    if (!window.electronAPI?.listSamples) {
      setSampleOptions((prev) => ({ ...prev, [currentTab]: [] }));
      mockAppendOutput(currentTab, "❌ Sample loading unavailable. Run inside Electron (npm run electron-dev).");
      setIsLoadingSamples(false);
      return;
    }
    let result;
    try {
      result = await window.electronAPI.listSamples({ language: currentTab, tool: currentTool });
    } catch (error) {
      setIsLoadingSamples(false);
      mockAppendOutput(currentTab, `❌ Failed: ${error instanceof Error ? error.message : "Unknown"}`);
      return;
    }
    setIsLoadingSamples(false);
    if (!result.ok) { mockAppendOutput(currentTab, `❌ ${result.error || "Unknown error"}`); return; }
    const options = (result.samples || []).map((s: { name?: string; path: string }) => ({
      name: s.name || getFileName(s.path), path: s.path,
    }));
    setSampleOptions((prev) => ({ ...prev, [currentTab]: options }));
    setSelectedLocalFilePath((prev) => ({ ...prev, [currentTab]: "" }));
    setSelectedSamplePath((prev) => ({ ...prev, [currentTab]: options[0]?.path || "" }));
    setSampleModalOpen(true);
    mockAppendOutput(currentTab, `✅ Loaded ${options.length} sample(s).`);
  };

  const browseLocalFile = async () => {
    // ✅ Validate eligibility BEFORE allowing file selection
    const isEligible = await validateTokenAndCheckEligibility(currentTab, (msg: string) => mockAppendOutput(currentTab, msg));
    if (!isEligible) {
      mockAppendOutput(currentTab, "❌ Cannot proceed: trials exhausted or session invalid.");
      return;
    }

    if (!window.electronAPI?.pickFile) {
      mockAppendOutput(currentTab, "❌ Desktop file picker unavailable. Run inside Electron (npm run electron-dev).");
      return;
    }
    const result = await window.electronAPI.pickFile();
    if (!result.ok || !("path" in result)) return;
    setSelectedLocalFilePath((prev) => ({ ...prev, [currentTab]: result.path }));
    if (currentTab === "solidity") {
      setSelectedLocalFolderPath("");
      setSoliditySourceMode("file");
    }
    setSelectedSamplePath((prev) => ({ ...prev, [currentTab]: "" }));
    mockAppendOutput(currentTab, `✅ Selected: ${getFileName(result.path)}`);
  };

  const browseSolidityFolder = async () => {
    // ✅ Validate eligibility BEFORE allowing folder selection
    const isEligible = await validateTokenAndCheckEligibility("solidity", (msg: string) => mockAppendOutput("solidity", msg));
    if (!isEligible) {
      mockAppendOutput("solidity", "❌ Cannot proceed: trials exhausted or session invalid.");
      return;
    }

    if (!window.electronAPI?.pickFolder) {
      mockAppendOutput("solidity", "❌ Folder picker unavailable. Run inside Electron (npm run electron-dev).");
      return;
    }
    const result = await window.electronAPI.pickFolder();

    if (!result.ok) {
      if (result.error) {
        mockAppendOutput("solidity", `❌ ${result.error}`);
      }
      return;
    }

    setSoliditySourceMode("folder");
    setSelectedLocalFolderPath(result.path);
    setSelectedLocalFilePath((prev) => ({ ...prev, solidity: "" }));
    setSelectedSamplePath((prev) => ({ ...prev, solidity: "" }));
    mockAppendOutput("solidity", `✅ Selected Solidity folder (${result.solCount} .sol file(s)): ${getFileName(result.path)}`);
  };

  const executeCommand = async (type: Tab) => {
    // Prevent multiple concurrent executions
    if (loading) {
      mockAppendOutput(type, "⚠️ Execution already in progress. Click Stop first.");
      return;
    }

    // Strict auth check - no tool execution without valid session
    if (!isAuthenticated) {
      mockAppendOutput(type, "❌ Session expired. Please login again.");
      setAuthLoading(true);
      setIsAuthenticated(false);
      return;
    }

    // Validate session token still exists in sessionStorage
    const token = sessionStorage.getItem("trustinn_token");
    if (!token) {
      mockAppendOutput(type, "❌ No valid session. Please login again.");
      setAuthLoading(true);
      setIsAuthenticated(false);
      return;
    }

    // Check if token is expired
    const expiryStr = sessionStorage.getItem("token_expires");
    if (expiryStr) {
      const expiryTime = new Date(expiryStr).getTime();
      if (expiryTime <= Date.now()) {
        mockAppendOutput(type, "❌ Session expired. Please login again.");
        sessionStorage.removeItem("trustinn_token");
        sessionStorage.removeItem("trustinn_user_id");
        sessionStorage.removeItem("token_expires");
        sessionStorage.removeItem("trustinn_user");
        setIsAuthenticated(false);
        return;
      }
    }

    // Validate token with backend and check trial/premium eligibility
    const isEligible = await validateTokenAndCheckEligibility(type, (msg: string) => mockAppendOutput(type, msg));
    if (!isEligible) {
      return;
    }

    console.log("[EXEC] executeCommand start", { type, tool: currentTool, inputMode, sourceType: inputMode, currentTab, loading, isCompiling });
    setTerminalOutputs((prev) => ({ ...prev, [type]: "" }));

    // Check tool selection
    if (!currentTool) { mockAppendOutput(type, "❌ Select a security tool first."); return; }

    const compactTools = new Set([
      DSE_MUTATION_TOOL,
      DYNAMIC_SYMBOLIC_TOOL,
      DSE_PRUNING_TOOL,
      ADVANCED_COVERAGE_TOOL,
      MUTATION_TESTING_TOOL,
      JBMC_TOOL,
      PYTHON_FUZZ_TOOL,
    ]);
    const compactTerminalOutput = compactTools.has(currentTool);
    setLoading(true);

    // Handle both file mode and code mode
    let sourceType: "sample" | "file" | "folder" | "code" = "file";
    let sourcePath: string | undefined;
    let codeContent: string | undefined;

    if (inputMode === "code") {
      // Code mode - pass code directly
      const code = userCode[type];
      if (!code || !code.trim()) {
        mockAppendOutput(type, "❌ No code to analyze. Write or paste code first.");
        setLoading(false);
        return;
      }
      sourceType = "code";
      codeContent = code;
    } else {
      // File mode
      const localPath = selectedLocalFilePath[type];
      const localFolderPath = type === "solidity" ? selectedLocalFolderPath : "";
      const samplePath = selectedSamplePath[type];

      if (type === "solidity" && soliditySourceMode === "folder") {
        sourceType = "folder";
        sourcePath = localFolderPath;
        if (!sourcePath || !sourcePath.trim()) {
          mockAppendOutput(type, "❌ No Solidity folder selected. Please browse and select a folder first.");
          setLoading(false);
          return;
        }
      } else {
        sourceType = localPath ? "file" : "sample";
        sourcePath = localPath || samplePath;
      }

      if (!sourcePath) {
        mockAppendOutput(type, "❌ Pick a sample or browse a file first.");
        setLoading(false);
        return;
      }

      // Validate local file extension matches language
      if (localPath && sourceType === "file") {
        const fileExt = localPath.split('.').pop()?.toLowerCase();
        const expectedExtensions: Record<Tab, string> = {
          c: 'c',
          java: 'java',
          python: 'py',
          solidity: 'sol',
        };
        const expectedExt = expectedExtensions[type];

        if (fileExt !== expectedExt) {
          mockAppendOutput(type, `❌ Invalid file type. For ${type.toUpperCase()}, only .${expectedExt} files are allowed.`);
          setLoading(false);
          return;
        }
      }
    }

    const params = type === "c" ? cParams : type === "solidity" ? solidityParams : "{}";

    if (!compactTerminalOutput) {
      mockAppendOutput(type, `[EXEC] Running ${currentTool}...`);
    } else {
      // Even for compact tools, show that we're starting
      mockAppendOutput(type, `[EXEC] Analyzing ${type.toUpperCase()} code...`);
    }
    
    // Notify user that we're checking Docker image availability
    mockAppendOutput(type, `[DOCKER] Checking Docker image availability...`);
    
    if (!window.electronAPI?.runTool) {
      mockAppendOutput(type, "❌ Tool execution unavailable. Electron IPC bridge not found.");
      setLoading(false);
      return;
    }

    let result;
    try {
      // Create a wrapper Promise that can be aborted
      let resolveWrapper: ((value: any) => void) | null = null;
      let rejectWrapper: ((error: any) => void) | null = null;
      
      const abortablePromise = new Promise((resolve, reject) => {
        resolveWrapper = resolve;
        rejectWrapper = reject;
      });
      
      // Add the handlers to the pending list so stopExecution can abort it
      if (resolveWrapper && rejectWrapper) {
        pendingPromisesRef.current.push({
          resolve: resolveWrapper,
          reject: rejectWrapper,
        });
      }
      
      // Add generous 2-hour timeout for security analysis tools (can take a long time)
      const backendTimeoutMs = 2 * 60 * 60 * 1000; // 2 hours
      const frontendTimeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Analysis timeout: Tool took longer than 2 hours"));
        }, backendTimeoutMs);
        timerIdsRef.current.push(timeoutId);
      });

      // Run the actual tool execution in the background
      if (resolveWrapper && rejectWrapper) {
        window.electronAPI.runTool({
          language: type,
          tool: currentTool,
          sourceType: sourceType as any,
          samplePath: sourceType === "sample" ? sourcePath : undefined,
          filePath: sourceType === "file" ? sourcePath : undefined,
          folderPath: sourceType === "folder" ? sourcePath : undefined,
          codeContent: sourceType === "code" ? codeContent : undefined,
          params,
          compile: false, // executeCommand runs analysis tools
        }).then(resolveWrapper).catch(rejectWrapper);
      }

      result = await Promise.race([
        abortablePromise,
        frontendTimeoutPromise,
      ]) as any;
      
      // Remove from pending if successful
      pendingPromisesRef.current = [];
      
    } catch (error) {
      // Remove from pending on error
      pendingPromisesRef.current = [];
      
      if (stopRequestedRef.current) {
        console.log("[EXEC] Tool execution was stopped by user");
        mockAppendOutput(type, "🛑 Tool execution stopped");
      } else {
        mockAppendOutput(type, `❌ ${error instanceof Error ? error.message : "Unknown"}`);
      }
      setLoading(false);
      return;
    }

    if (!result.output || result.output.trim().length === 0) {
      mockAppendOutput(type, `[Tool Result] Status: ${result.ok ? "OK" : "FAILED"}, Message: ${result.error || "No output"}`);
    }

    const rawOutput = result.output || "";
    let displayOutput = rawOutput.trim();
    let nextChartData: ChartDatum[] = [];
    let nextTitle = `${type.toUpperCase()} Execution Summary`;
    let nextPercentageItems: string[] = [];

    // Log ACCP output for debugging
    if (currentTool === ADVANCED_COVERAGE_TOOL) {
      console.log(`[ACCP-UI] Raw output length: ${rawOutput.length}`);
      console.log(`[ACCP-UI] Has SC-MCC: ${rawOutput.includes("SC-MCC")}`);
      console.log(`[ACCP-UI] Output first 200 chars: ${rawOutput.substring(0, 200)}`);
      console.log(`[ACCP-UI] Output last 200 chars: ${rawOutput.substring(Math.max(0, rawOutput.length - 200))}`);
    }

    if (currentTool === DSE_MUTATION_TOOL) {
      displayOutput = extractMutationReportBlock(rawOutput);
      const metrics = parseMutationMetrics(displayOutput);
      nextTitle = "Mutation Score Analytics";
      if (metrics) {
        nextChartData = mutationMetricsToChartData(metrics);
        nextPercentageItems = [`Mutation Score (Killed/Reached): ${metrics.score}%`];
      }
    } else if (currentTool === DYNAMIC_SYMBOLIC_TOOL) {
      displayOutput = extractDynamicSymbolicSummary(rawOutput);
      const metrics = parseDynamicSymbolicMetrics(rawOutput);
      nextTitle = "Dynamic Symbolic Execution Analytics";
      if (metrics) {
        nextChartData = dynamicSymbolicMetricsToChartData(metrics);
        nextPercentageItems = [
          `ICov: ${metrics.icovPercent}%`,
          `BCov: ${metrics.bcovPercent}%`,
          `TSolver: ${metrics.tsolverPercent}%`,
        ];
      }
    } else if (currentTool === DSE_PRUNING_TOOL) {
        displayOutput = extractDsePruningSummary(rawOutput);
        const metrics = parseDynamicSymbolicMetrics(rawOutput);
        nextTitle = "DSE with Pruning Analytics";
        if (metrics) {
          nextChartData = dynamicSymbolicMetricsToChartData(metrics);
          nextPercentageItems = [
            `ICov: ${metrics.icovPercent}%`,
            `BCov: ${metrics.bcovPercent}%`,
            `TSolver: ${metrics.tsolverPercent}%`,
          ];
        }
      } else if (currentTool === ADVANCED_COVERAGE_TOOL) {
        displayOutput = extractAdvancedCoverageSummary(rawOutput);
        const metrics = parseAdvancedCoverageMetrics(displayOutput);
        nextTitle = "Advanced Coverage Analytics";
        if (metrics) {
          nextChartData = advancedCoverageToChartData(metrics);
          nextPercentageItems = [
            `MC/DC Score: ${metrics.mcdcScore}`,
            `SC-MCC Score: ${metrics.scmccScore}`,
          ];
        }
      } else if (currentTool === MUTATION_TESTING_TOOL) {
        displayOutput = extractMutationTestingSummary(rawOutput);
        const metrics = parseMutationTestingMetrics(displayOutput);
        nextTitle = "Mutation Testing Analytics";
        if (metrics) {
          nextChartData = mutationTestingToChartData(metrics);
          nextPercentageItems = [`Mutation Score: ${metrics.score}`];
        }
      } else if (currentTool === JBMC_TOOL) {
        displayOutput = extractJbmcSummary(rawOutput);
        const metrics = parseJbmcMetrics(displayOutput);
        nextTitle = "JBMC Assertion Analytics";
        if (metrics) {
          nextChartData = jbmcToChartData(metrics);
          nextPercentageItems = [`Conditional Coverage: ${metrics.conditionalCoverage}%`];
        }
      } else if (currentTool === PYTHON_FUZZ_TOOL) {
        displayOutput = extractPythonFuzzSummary(rawOutput);
        const metrics = parsePythonFuzzMetrics(displayOutput);
        nextTitle = "Condition Coverage Fuzzing Analytics";
        if (metrics) {
          nextChartData = pythonFuzzToChartData(metrics);
          nextPercentageItems = [`Conditional Coverage: ${metrics.conditionalCoverage}%`];
        }
      } else if (currentTool === VERISOL_TOOL) {
        displayOutput = rawOutput; // Show full output for VeriSol without trimming
        const metrics = parseVeriSolMetrics(rawOutput);
        nextTitle = "VeriSol Analytics";
        if (metrics) {
          nextChartData = veriSolToChartData(metrics);
          nextPercentageItems = [`Condition Coverage: ${metrics.coverage}%`];
        }
      }

      if (displayOutput) {
        displayOutput.split("\n").forEach((l: string) => { if (l.trim()) mockAppendOutput(type, l); });
      } else if (rawOutput && rawOutput.trim()) {
        // If extraction didn't work, show raw output
        mockAppendOutput(type, "[Raw Output]");
        rawOutput.split("\n").forEach((l: string) => { if (l.trim()) mockAppendOutput(type, l); });
      }

      setChartData(nextChartData);
      setVisualizationTitle(nextTitle);
      setPercentageItems(nextPercentageItems);

      // Check if process was stopped by user
      if (stopRequestedRef.current) {
        console.log("[EXEC] Process was stopped by user request");
        mockAppendOutput(type, "🛑 Tool execution stopped");
        setLoading(false);
        // Reset stop flag
        setTimeout(() => {
          stopRequestedRef.current = false;
        }, 100);
        return;
      }

      // Show output first, then status
      if (result.output) {
        // Has output - execution happened (successful execution)
        if (!compactTerminalOutput) {
          mockAppendOutput(type, "✅ Execution completed.");
        }
        
        // Show where results are saved
        if (result.resultsDir) {
          mockAppendOutput(type, `📁 Results saved to: ${result.resultsDir}`);
        }
        
        // Only deduct trial if execution happened (not if compilation failed)
        if (result.trialDeducted !== false) {
          await deductTrialAndCheckStatus();
        }
      } else if (!result.ok) {
        // No output and not ok - actual failure
        mockAppendOutput(type, `❌ Failed${result.error ? `: ${result.error}` : ""}`);
      }
      
      // Clean up temp file if it was created
      const tempFilePath = tempFilePaths[type];
      if (tempFilePath && inputMode === "code") {
        try {
          await window.electronAPI?.deleteTempFile(tempFilePath);
          setTempFilePaths((prev) => ({ ...prev, [type]: "" }));
        } catch (error) {
          // Silently fail if cleanup doesn't work
          console.warn("Failed to clean up temp file:", error);
        }
      }
      
      setLoading(false);
  };

  const compileCode = async (type: Tab) => {
    // Prevent multiple concurrent compilations
    if (isCompiling) {
      mockAppendOutput(type, "⚠️ Compilation already in progress. Click Stop first.");
      return;
    }

    // Auth check
    if (!isAuthenticated) {
      mockAppendOutput(type, "❌ Session expired. Please login again.");
      return;
    }

    // Check if token is still valid
    const token = sessionStorage.getItem("trustinn_token");
    if (!token) {
      mockAppendOutput(type, "❌ Session expired. Please login again.");
      setIsAuthenticated(false);
      return;
    }

    // Validate token with backend and check trial/premium eligibility
    const isEligible = await validateTokenAndCheckEligibility(type, (msg: string) => mockAppendOutput(type, msg));
    if (!isEligible) {
      return;
    }

    setTerminalOutputs((prev) => ({ ...prev, [type]: "" }));
    setIsCompiling(true);
    console.log("[COMPILE] compileCode start", { type, tool: currentTool, inputMode, currentTab });

    const compactTools = new Set([
      DSE_MUTATION_TOOL,
      DYNAMIC_SYMBOLIC_TOOL,
      DSE_PRUNING_TOOL,
      ADVANCED_COVERAGE_TOOL,
      MUTATION_TESTING_TOOL,
      JBMC_TOOL,
      PYTHON_FUZZ_TOOL,
    ]);
    const compactTerminalOutput = compactTools.has(currentTool);

    // Handle both file mode and code mode
    let sourceType: "sample" | "file" | "folder" | "code" = "file";
    let sourcePath: string | undefined;
    let codeContent: string | undefined;

    if (inputMode === "code") {
      // Code mode - pass code directly
      const code = userCode[type];
      if (!code || !code.trim()) {
        mockAppendOutput(type, "❌ No code to compile/execute. Write or paste code first.");
        setIsCompiling(false);
        return;
      }
      sourceType = "code";
      codeContent = code;
    } else {
      // File mode
      const localPath = selectedLocalFilePath[type];
      const localFolderPath = type === "solidity" ? selectedLocalFolderPath : "";
      const samplePath = selectedSamplePath[type];

      if (type === "solidity" && soliditySourceMode === "folder") {
        sourceType = "folder";
        sourcePath = localFolderPath;
        if (!sourcePath || !sourcePath.trim()) {
          mockAppendOutput(type, "❌ No Solidity folder selected. Please browse and select a folder first.");
          setIsCompiling(false);
          return;
        }
      } else {
        sourceType = localPath ? "file" : "sample";
        sourcePath = localPath || samplePath;
      }

      if (!sourcePath) {
        mockAppendOutput(type, "❌ No file selected. Please select a file first.");
        setIsCompiling(false);
        return;
      }

      // Validate file extension matches language
      if (sourceType === "file") {
        const fileExt = sourcePath.split('.').pop()?.toLowerCase();
        const expectedExtensions: Record<Tab, string> = {
          c: 'c',
          java: 'java',
          python: 'py',
          solidity: 'sol',
        };
        const expectedExt = expectedExtensions[type];

        if (fileExt !== expectedExt) {
          mockAppendOutput(type, `❌ Invalid file type. For ${type.toUpperCase()}, only .${expectedExt} files are allowed.`);
          setIsCompiling(false);
          return;
        }
      }
    }

    const params = type === "c" ? cParams : type === "solidity" ? solidityParams : "{}";

    mockAppendOutput(type, `[Compilation] Compiling and executing ${type.toUpperCase()} code...`);
    
    // Notify user that we're checking Docker image availability
    mockAppendOutput(type, `[DOCKER] Checking Docker image availability...`);

    if (!window.electronAPI?.runTool) {
      mockAppendOutput(type, "❌ Tool execution unavailable. Electron IPC bridge not found.");
      setIsCompiling(false);
      return;
    }

    let result;
    try {
      // Create a wrapper Promise that can be aborted
      let resolveWrapper: ((value: any) => void) | null = null;
      let rejectWrapper: ((error: any) => void) | null = null;
      
      const abortablePromise = new Promise((resolve, reject) => {
        resolveWrapper = resolve;
        rejectWrapper = reject;
      });
      
      // Add the handlers to the pending list so stopExecution can abort it
      if (resolveWrapper && rejectWrapper) {
        pendingPromisesRef.current.push({
          resolve: resolveWrapper,
          reject: rejectWrapper,
        });
      }
      
      // Add 35-second timeout on frontend (backend is 30s, +5s buffer)
      const frontendTimeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Compilation timeout: Process took longer than 35 seconds"));
        }, 35000);
        timerIdsRef.current.push(timeoutId);
      });

      // Run the actual tool execution in the background
      if (resolveWrapper && rejectWrapper) {
        console.log("[COMPILE] Sending runTool payload", {
          language: type,
          tool: currentTool,
          sourceType,
          samplePath: sourceType === "sample" ? sourcePath : undefined,
          filePath: sourceType === "file" ? sourcePath : undefined,
          folderPath: sourceType === "folder" ? sourcePath : undefined,
          codeContent: sourceType === "code" ? codeContent : undefined,
          params,
          compile: true,
        });
        window.electronAPI.runTool({
          language: type,
          tool: currentTool,
          sourceType: sourceType as any,
          samplePath: sourceType === "sample" ? sourcePath : undefined,
          filePath: sourceType === "file" ? sourcePath : undefined,
          folderPath: sourceType === "folder" ? sourcePath : undefined,
          codeContent: sourceType === "code" ? codeContent : undefined,
          params,
          compile: true,
        }).then(resolveWrapper).catch(rejectWrapper);
      }

      // Race between the tool promise and timeout
      result = await Promise.race([
        abortablePromise,
        frontendTimeoutPromise,
      ]) as any;
      
      // Remove from pending if successful
      pendingPromisesRef.current = [];
      
    } catch (error) {
      // Remove from pending on error
      pendingPromisesRef.current = [];
      
      if (stopRequestedRef.current) {
        console.log("[COMPILE] Compilation was stopped by user");
        mockAppendOutput(type, "🛑 Compilation stopped");
      } else {
        mockAppendOutput(type, `❌ ${error instanceof Error ? error.message : "Unknown error"}`);
      }
      setIsCompiling(false);
      return;
    }

    // Process result
    if (stopRequestedRef.current) {
      // Process was stopped by user - treat as successful stop
      console.log("[COMPILE] Process was stopped by user request");
      mockAppendOutput(type, "🛑 Compilation stopped");
      setIsCompiling(false);
      // Reset stop flag
      setTimeout(() => {
        stopRequestedRef.current = false;
      }, 100);
      return;
    }
    
    if (result.output) {
      // Has output - execution happened (successful execution)
      if (result.output.includes("\n")) {
        result.output.split("\n").forEach((l: string) => { if (l.trim()) mockAppendOutput(type, l); });
      } else {
        mockAppendOutput(type, result.output);
      }
      if (!compactTerminalOutput) {
        mockAppendOutput(type, "✅ Execution completed.");
      }
      
      // Only deduct trial if execution happened (not if compilation failed)
      if (result.trialDeducted !== false) {
        await deductTrialAndCheckStatus();
      }
    } else if (!result.ok) {
      // No output and not ok - actual failure
      mockAppendOutput(type, `❌ ${result.error || "Unknown error"}`);
    }

    setIsCompiling(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(terminalOutputs[currentTab] || "").catch(() => {});
  };

  const copyPercentageItem = (item: string) => {
    if (!item) return;
    navigator.clipboard.writeText(item).catch(() => {});
  };

  const terminalLines = (terminalOutputs[currentTab] || "").split("\n");

  const getLineStyle = (line: string): CSSProperties => {
    if (line.startsWith("❌") || line.includes("Error"))
      return { color: "#fca5a5", background: "rgba(248,113,113,0.07)" };
    if (line.startsWith("✅"))
      return { color: "#86efac", background: "rgba(34,197,94,0.06)" };
    if (line.startsWith("[EXEC]") || line.startsWith("[Run]") || line.startsWith("[Compilation]") || line.startsWith("[Execution]"))
      return { color: "#93c5fd", background: "rgba(59,130,246,0.07)" };
    if (line.startsWith("🛑"))
      return { color: "#fcd34d", background: "rgba(250,204,21,0.06)" };
    if (line.startsWith("ℹ"))
      return { color: "#a5b4fc", background: "transparent" };
    return { color: "#d1d5db", background: "transparent" };
  };

  /* ── Shared action buttons ── */
  const ActionButtons = () => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
      <button
        onClick={() => executeCommand(currentTab)}
        disabled={loading}
        style={{
          padding: "12px 16px",
          borderRadius: 10,
          border: "none",
          background: loading ? "linear-gradient(135deg, #86efac, #34d399)" : TOKEN.greenGradient,
          color: "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: loading ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          boxShadow: loading ? "0 2px 8px rgba(74,222,128,0.3)" : TOKEN.shadowMd,
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          opacity: loading ? 0.85 : 1,
        }}
        onMouseEnter={(e) => !loading && (e.currentTarget.style.transform = "translateY(-2px)")}
        onMouseLeave={(e) => !loading && (e.currentTarget.style.transform = "translateY(0)")}
      >
        {loading
          ? <><FaSpinner style={{ animation: "spin 1s linear infinite" }} size={13} /> Running…</>
          : "▶ Execute"}
      </button>
      <button
        onClick={() => stopExecution("Stopped")}
        disabled={!loading && !isCompiling}
        style={{
          padding: "12px 16px",
          borderRadius: 10,
          border: (!loading && !isCompiling) ? "2px solid #e2e8f0" : "none",
          background: (!loading && !isCompiling) ? "#f1f5f9" : TOKEN.redGradient,
          color: (!loading && !isCompiling) ? "#94a3b8" : "#fff",
          fontSize: 13,
          fontWeight: 700,
          cursor: (!loading && !isCompiling) ? "not-allowed" : "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 7,
          boxShadow: (!loading && !isCompiling) ? "none" : TOKEN.shadowMd,
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          opacity: (!loading && !isCompiling) ? 0.65 : 1,
        }}
        onMouseEnter={(e) => (loading || isCompiling) && (e.currentTarget.style.transform = "translateY(-2px)")}
        onMouseLeave={(e) => (loading || isCompiling) && (e.currentTarget.style.transform = "translateY(0)")}
      >
        <FiSquare size={13} /> Stop
      </button>
    </div>
  );

  /* ────────────────────────────────────────────────────────────
     RENDER
  ──────────────────────────────────────────────────────────── */
  
  // Loading screen
  if (authLoading) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(255,255,255,0.95)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 16,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: "50%", border: "3px solid #e5e7eb",
          borderTopColor: "#6366f1", animation: "spin 0.8s linear infinite",
        }} />
        <div style={{fontSize: 18, fontWeight: 800, color: "#111827"}}>TrustInn Initializing</div>
        <div style={{fontSize: 13, color: "#9ca3af"}}>Validating your session...</div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  // Auth gate - show NoAccessError if not authenticated
  if (!isAuthenticated) {
    // Import or return auth gate component
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(255,255,255,0.95)", zIndex: 100,
        display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 20, padding: 20,
      }}>
        <div style={{textAlign: "center"}}>
          <div style={{fontSize: 24, fontWeight: 800, color: "#111827", marginBottom: 8}}>⚠️ Session Expired</div>
          <div style={{fontSize: 14, color: "#6b7280", marginBottom: 20}}>Your session data has been cleared. Please login again to continue.</div>
          <button onClick={() => void navigateToRoute("/")} style={{
            padding: "10px 20px", background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
            border: "none", borderRadius: 8, color: "#fff", fontSize: 14, fontWeight: 700,
            cursor: "pointer", boxShadow: "0 4px 12px rgba(99,102,241,0.3)",
          }}>
            ← Go to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        height: "100vh", overflow: "hidden",
        display: "flex", flexDirection: "column",
        background: "linear-gradient(135deg, #f0f4ff 0%, #e0e7ff 50%, #f0f9ff 100%)",
        padding: "20px 24px 16px", gap: 14,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", sans-serif',
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: rgba(15,23,42,0.05); border-radius: 10px; }
        ::-webkit-scrollbar-thumb { background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: linear-gradient(135deg, #4f46e5, #7c3aed); }
      `}</style>

      {/* ── Trial Exhaustion Warning ── */}
      {trialsExhausted && (
        <div style={{
          background: "linear-gradient(135deg, #dc2626, #b91c1c)",
          border: "1px solid #991b1b",
          borderRadius: 12,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: "#fff",
          fontWeight: 600,
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div>No trials remaining</div>
            <div style={{ fontSize: 12, fontWeight: 400, marginTop: 2, opacity: 0.9 }}>
              Upgrade to premium to continue using tools. Docker image has been removed.
            </div>
          </div>
          <button
            onClick={() => void navigateToRoute("/pricing")}
            style={{
              background: "#fff",
              color: "#dc2626",
              border: "none",
              borderRadius: 6,
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Upgrade
          </button>
        </div>
      )}

      {/* ── Modern Header with Glassmorphism ── */}
     <header
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    background: "rgba(255, 255, 255, 0.92)",
    backdropFilter: "blur(24px)",
    WebkitBackdropFilter: "blur(24px)",
    border: "1px solid rgba(226, 232, 240, 0.85)",
    borderRadius: 24,
    padding: "20px 28px",
    boxShadow: `
      0 10px 30px -10px rgba(0, 0, 0, 0.08),
      0 4px 12px -2px rgba(99, 102, 241, 0.12)
    `,
    flexShrink: 0,
    position: "relative",
    overflow: "hidden",
  }}
>
  {/* Subtle gradient overlay at top */}
  <div
    style={{
      position: "absolute",
      inset: 0,
      background: "linear-gradient(to bottom, rgba(99,102,241,0.04), transparent)",
      pointerEvents: "none",
      borderRadius: 24,
    }}
  />

  <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
    {/* Logo Container - Enhanced */}
    <div
      style={{
        width: 68,
        height: 68,
        background: TOKEN.accentGradient,
        borderRadius: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `
          0 10px 20px rgba(99, 102, 241, 0.3),
          inset 0 -4px 8px rgba(255,255,255,0.4)
        `,
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          // background: "rgba(255,255,255,0.15)",
          borderRadius: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Image
          src={logoSrc}
          alt="TrustInn logo"
          width={46}
          height={46}
          priority
          style={{ filter: "brightness(0) invert(1)" }}
        />
      </div>
    </div>

    {/* Brand Text */}
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 30,
          fontWeight: 800,
          background: TOKEN.accentGradient,
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          lineHeight: 1.1,
          letterSpacing: "-0.025em",
        }}
      >
        TrustInn
      </div>
      <div
        style={{
          fontSize: 13.5,
          color: TOKEN.textMuted,
          fontWeight: 600,
          marginTop: 3,
          letterSpacing: "-0.01em",
        }}
      >
        NITMiner Technologies Pvt. Ltd.
      </div>
    </div>
  </div>

  {/* Navigation / Session Button - Premium Look */}
  <nav className="flex items-center gap-3 flex-wrap">
    {!authLoading && userData && (
      <button
        onClick={() => setShowSessionModal(true)}
        className={`group flex items-center gap-3.5 px-5 py-3 rounded-2xl border transition-all duration-300 shadow-sm active:scale-[0.97] hover:shadow-xl
          ${userData.isPremium 
            ? "bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200 hover:border-emerald-300 hover:from-emerald-100 hover:to-green-100" 
            : "bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-200 hover:border-blue-300 hover:from-blue-100 hover:to-indigo-100"
          }`}
      >
        {/* Icon with subtle animation */}
        <div className="relative">
          {userData.isPremium ? (
            <Crown 
              size={22} 
              className="text-emerald-600 transition-transform group-hover:scale-110" 
            />
          ) : (
            <Lock 
              size={22} 
              className="text-blue-600 transition-transform group-hover:scale-110" 
            />
          )}
        </div>

        {/* Text Content */}
        <div className="text-left leading-tight pr-1">
          <div className="text-[10px] font-semibold tracking-[0.5px] text-gray-500 uppercase">
            SESSION
          </div>
          <div className={`text-sm font-semibold tracking-tight ${
            userData.isPremium ? "text-emerald-700" : "text-blue-700"
          }`}>
            {userData.isPremium ? "Premium Active" : "Free Session"}
          </div>
        </div>

        {/* Subtle indicator dot for premium */}
        {userData.isPremium && (
          <div className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-200 animate-pulse" />
        )}
      </button>
    )}
  </nav>
</header>
      
      {/* Session Info Modal */}
      <SessionCheckModal
        isOpen={showSessionModal}
        user={userData}
        onClose={() => setShowSessionModal(false)}
      />

      {/* Image Setup Modal */}
      {showImageSetupModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 10000, backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: "white", borderRadius: 16, padding: 40, maxWidth: 420,
            textAlign: "center", boxShadow: "0 10px 40px rgba(0,0,0,0.2)"
          }}>
            <div style={{
              width: 60, height: 60, background: "#f0f4ff", borderRadius: "50%",
              margin: "0 auto 20px", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 32
            }}>
              ⚙️
            </div>
            <h2 style={{ margin: "0 0 12px", fontSize: 20, fontWeight: 600, color: "#1a1a1a" }}>
              Setting up your tools
            </h2>
            <p style={{
              margin: "0 0 24px", fontSize: 14, color: "#666",
              lineHeight: 1.5
            }}>
              {imageSetupStatus}
            </p>

            {imageSetupLoading && (
              <div style={{ margin: "24px 0" }}>
                <div style={{
                  fontSize: 24, fontWeight: 700, color: "#6366f1",
                  marginBottom: 12
                }}>
                  {imageSetupProgress}%
                </div>

                <div style={{
                  width: "100%", height: 8, background: "#e2e8f0",
                  borderRadius: 999, overflow: "hidden", marginBottom: 4
                }}>
                  <div style={{
                    height: "100%", background: "linear-gradient(90deg, #6366f1, #8b5cf6)",
                    width: `${imageSetupProgress}%`,
                    transition: "width 0.3s ease",
                    borderRadius: 999
                  }} />
                </div>

                <div style={{
                  fontSize: 12, color: "#94a3b8",
                  marginTop: 8
                }}>
                  {imageSetupProgress < 100
                    ? `Downloading... ${imageSetupProgress}% complete`
                    : "Installation complete!"}
                </div>

                <button
                  onClick={() => void stopImageSetup()}
                  disabled={isStoppingSetup}
                  style={{
                    marginTop: 14,
                    padding: "8px 14px",
                    borderRadius: 8,
                    border: "1px solid #cbd5e1",
                    background: "#f8fafc",
                    color: "#334155",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: isStoppingSetup ? "not-allowed" : "pointer",
                    opacity: isStoppingSetup ? 0.7 : 1,
                  }}
                >
                  {isStoppingSetup ? "Stopping..." : "Stop Setup"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* No Trials Modal */}
      {showNoTrialsModal && (
        <div style={{
          position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
          background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center",
          justifyContent: "center", zIndex: 10001, backdropFilter: "blur(4px)"
        }}>
          <div style={{
            background: "#ffffff", borderRadius: 16, padding: 40, maxWidth: 420,
            textAlign: "center", boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
            border: "1px solid #fee2e2"
          }}>
            <div style={{
              width: 80, height: 80, background: "#fecaca", borderRadius: "50%",
              margin: "0 auto 24px", display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 40
            }}>
              🚫
            </div>
            <h2 style={{ margin: "0 0 12px", fontSize: 22, fontWeight: 700, color: "#dc2626" }}>
              No Trials Remaining
            </h2>
            <p style={{
              margin: "0 0 24px", fontSize: 15, color: "#64748b",
              lineHeight: 1.6
            }}>
              You've used all your trial executions. <strong>Upgrade to Premium</strong> to unlock unlimited access to all tools.
            </p>
            
            <div style={{
              background: "#f8fafc", borderRadius: 12, padding: 16, marginBottom: 24,
              border: "1px solid #e2e8f0", textAlign: "left"
            }}>
              <div style={{ fontSize: 13, color: "#475569", marginBottom: 12 }}>
                <strong>Premium includes:</strong>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#64748b", lineHeight: 1.8 }}>
                <li>Unlimited tool executions</li>
                <li>Priority support</li>
                <li>Advanced features</li>
                <li>API access</li>
              </ul>
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => setShowNoTrialsModal(false)}
                style={{
                  flex: 1,
                  padding: "10px 20px", background: "#f1f5f9",
                  border: "1px solid #cbd5e1", borderRadius: 8, color: "#475569",
                  fontSize: 14, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.2s",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#e2e8f0")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#f1f5f9")}
              >
                Later
              </button>
              <button
                onClick={() => void navigateToRoute("/pricing")}
                style={{
                  flex: 1,
                  padding: "10px 20px", background: "linear-gradient(135deg,#dc2626,#b91c1c)",
                  border: "none", borderRadius: 8, color: "#fff",
                  fontSize: 14, fontWeight: 600,
                  cursor: "pointer", transition: "all 0.2s",
                  boxShadow: "0 4px 12px rgba(220,38,38,0.3)"
                }}
                onMouseEnter={(e) => (e.currentTarget.style.boxShadow = "0 6px 16px rgba(220,38,38,0.4)")}
                onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "0 4px 12px rgba(220,38,38,0.3)")}
              >
                Upgrade Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header with Refresh Button ── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "12px 16px", 
        background: "rgba(255, 255, 255, 0.7)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderRadius: 14,
        border: "1px solid rgba(226, 232, 240, 0.6)",
        boxShadow: TOKEN.shadow,
        flexShrink: 0
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: TOKEN.text, letterSpacing: "0.01em" }}>
          Select Programming Language
        </span>
        <button
          onClick={() => void refreshTrialStatus()}
          disabled={isRefreshingTrial}
          style={{
            padding: "6px 12px", borderRadius: 6, border: `1px solid ${TOKEN.border}`,
            background: TOKEN.bg, color: TOKEN.text, fontSize: 12, fontWeight: 600,
            cursor: isRefreshingTrial ? "not-allowed" : "pointer",
            display: "flex", alignItems: "center", gap: 6,
            opacity: isRefreshingTrial ? 0.6 : 1,
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => !isRefreshingTrial && (e.currentTarget.style.background = TOKEN.bgSurface)}
          onMouseLeave={(e) => (e.currentTarget.style.background = TOKEN.bg)}
          title="Refresh trial status from server"
        >
          <span style={{ display: "inline-block", animation: isRefreshingTrial ? "spin 1s linear infinite" : "none" }}>
            🔄
          </span>
          {isRefreshingTrial ? "Refreshing..." : "Refresh Status"}
        </button>
      </div>

      {/* ── Modern Language Tabs with Gradients ── */}
      <div
        style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
          gap: 6, 
          background: "rgba(255, 255, 255, 0.6)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          border: "1px solid rgba(226, 232, 240, 0.6)",
          borderRadius: 16, 
          padding: 6, 
          flexShrink: 0,
          boxShadow: TOKEN.shadow,
        }}
      >
        {(["c", "java", "python", "solidity"] as Tab[]).map((tab) => {
          const { label, Icon, iconColor } = LANG_META[tab];
          const active = currentTab === tab;
          return (
            <button
              key={tab}
              onClick={() => switchTab(tab)}
              style={{
                padding: "14px 0", 
                borderRadius: 12, 
                border: "none",
                fontSize: 15, 
                fontWeight: active ? 700 : 600,
                cursor: "pointer",
                background: active ? TOKEN.accentGradient : "rgba(255, 255, 255, 0.4)",
                color: active ? "#ffffff" : TOKEN.textSub,
                display: "flex", 
                alignItems: "center", 
                justifyContent: "center", 
                gap: 8,
                transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                boxShadow: active ? TOKEN.shadowMd : "0 1px 2px rgba(0,0,0,0.05)",
                transform: active ? "translateY(-1px)" : "translateY(0)",
              }}
              onMouseEnter={(e) => !active && (e.currentTarget.style.background = "rgba(255, 255, 255, 0.8)")}
              onMouseLeave={(e) => !active && (e.currentTarget.style.background = "rgba(255, 255, 255, 0.4)")}
            >
              <Icon size={18} style={{ color: active ? "#fff" : iconColor, flexShrink: 0 }} />
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Main Grid ── */}
      <div
        style={{
          display: "grid", gridTemplateColumns: "minmax(0, 0.45fr) minmax(0, 0.85fr)",
          gap: 10, flex: 1, minHeight: 0, overflow: "hidden",
        }}
      >
        {/* ── Left Panel ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>

          {/* Tool config card */}
          <div style={{ ...S.card, flexShrink: 0 }}>
            <span style={S.label}>Tool Configuration</span>
            <label style={{ ...S.label, textTransform: "none", letterSpacing: 0, fontSize: 11, marginBottom: 4 }}>
              Security tool
            </label>
            <select value={currentTool} onChange={(e) => handleToolChange(e.target.value)} style={S.select}>
              <option value="">Select a tool…</option>
              {currentTab === "c" && (
                <>
                  <option value="Condition Satisfiability Analysis">CC-Bounded Model Checker</option>
                  <option value="DSE based Mutation Analyser">DSE Mutation Analyser</option>
                  <option value="Dynamic Symbolic Execution">Dynamic Symbolic Execution</option>
                  <option value="Dynamic Symbolic Execution with Pruning">DSE with Pruning</option>
                  <option value="Advance Code Coverage Profiler">Advance Code Coverage Profiler</option>
                  <option value="Mutation Testing Profiler">Mutation Testing Profiler</option>
                </>
              )}
              {currentTab === "java" && <option value="JBMC">JBMC — Java Bounded Model Checker</option>}
              {currentTab === "python" && <option value="Condition Coverage Fuzzing">Condition Coverage Fuzzing</option>}
              {currentTab === "solidity" && <option value="VeriSol">Solidity — Smart Contract Verifier</option>}
            </select>
            {inputMode === "code" && (
              <div style={{ fontSize: 10, color: TOKEN.textMuted, marginTop: 4 }}>
                Note: Compile executes code directly. Execute runs selected security tool.
              </div>
            )}

            {/* Param boxes */}
            {currentTab === "c" && cTool === "Condition Satisfiability Analysis" && (
              <div style={S.paramBox}>
                <label style={S.paramLabel}>Unwind bound</label>
                <input type="number" value={cbmcBound} onChange={(e) => setCbmcBound(e.target.value)} style={S.select} />
              </div>
            )}
            {currentTab === "c" && cTool === "DSE based Mutation Analyser" && (
              <div style={S.paramBox}>
                <label style={S.paramLabel}>Tool value</label>
                <select value={kleemaValue} onChange={(e) => setKleemaValue(e.target.value)} style={S.select}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </div>
            )}
            {currentTab === "c" && (cTool === "Advance Code Coverage Profiler" || cTool === "Mutation Testing Profiler") && (
              <div style={{ ...S.paramBox, display: "flex", flexDirection: "column", gap: 8 }}>
                <div>
                  <label style={S.paramLabel}>Version</label>
                  <select
                    value={cTool === "Advance Code Coverage Profiler" ? gmcovVersion : gmutantVersion}
                    onChange={(e) => cTool === "Advance Code Coverage Profiler" ? setGmcovVersion(e.target.value) : setGmutantVersion(e.target.value)}
                    style={S.select}
                  ><option value="4">4</option></select>
                </div>
                <div>
                  <label style={S.paramLabel}>Time bound (s)</label>
                  <input
                    type="number"
                    value={cTool === "Advance Code Coverage Profiler" ? gmcovTimebound : gmutantTimebound}
                    onChange={(e) => cTool === "Advance Code Coverage Profiler" ? setGmcovTimebound(e.target.value) : setGmutantTimebound(e.target.value)}
                    style={S.select}
                  />
                </div>
                {cTool === "Mutation Testing Profiler" && (
                  <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 7, padding: "7px 10px", fontSize: 10.5, color: "#92400e", lineHeight: 1.5 }}>
                    ⚠️ Generates mutants from C source. Requires <code style={{ background: "#fef3c7", padding: "1px 4px", borderRadius: 3 }}>main()</code>.
                  </div>
                )}
              </div>
            )}
            {currentTab === "solidity" && solidityTool === "VeriSol" && (
              <div style={S.paramBox}>
                <label style={S.paramLabel}>Verification mode</label>
                <select value={solidityMode} onChange={(e) => setSolidityMode(e.target.value)} style={S.select}>
                  <option value="bmc">Bounded Model Checker</option>
                  <option value="chc">Constrained Horn Clauses</option>
                </select>
              </div>
            )}
          </div>

          {/* Input card */}
          <div
            style={{
              ...S.card, padding: 0,
              display: "flex", flexDirection: "column",
              flex: 1, minHeight: 0, overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "9px 14px", borderBottom: `1px solid ${TOKEN.border}`,
                display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: TOKEN.text }}>Input</span>
              <div style={{ display: "flex", gap: 3, background: TOKEN.bgDeep, borderRadius: 999, padding: 3, border: `1px solid ${TOKEN.border}` }}>
                {(["file", "code"] as InputMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setInputMode(m)}
                    style={{
                      padding: "4px 12px", fontSize: 11, borderRadius: 999,
                      border: "none", cursor: "pointer",
                      background: inputMode === m ? TOKEN.text : "transparent",
                      color: inputMode === m ? "#f9fafb" : TOKEN.textSub,
                      fontWeight: inputMode === m ? 600 : 400, transition: "all 0.15s",
                    }}
                  >
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 9 }}>
              {inputMode === "file" ? (
                <>
                  {currentTab === "solidity" && (
                    <div style={{ display: "flex", gap: 6 }}>
                      {(["file", "folder"] as SoliditySourceMode[]).map((mode) => (
                        <button
                          key={mode}
                          onClick={() => {
                            setSoliditySourceMode(mode);
                            setSelectedSamplePath((prev) => ({ ...prev, solidity: "" }));
                            setSelectedLocalFilePath((prev) => ({ ...prev, solidity: "" }));
                            setSelectedLocalFolderPath("");
                          }}
                          style={{
                            ...S.outlineBtn,
                            flex: 1,
                            background: soliditySourceMode === mode ? TOKEN.text : TOKEN.bg,
                            color: soliditySourceMode === mode ? "#fff" : TOKEN.text,
                            borderColor: soliditySourceMode === mode ? TOKEN.text : TOKEN.border,
                          }}
                        >
                          {mode === "file" ? "📄 File" : "📁 Folder"}
                        </button>
                      ))}
                    </div>
                  )}

                  <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "7px 10px", fontSize: 11, color: "#92400e", lineHeight: 1.5 }}>
                    ⚠️ Make sure there are no infinite loops in your code. Use the Stop button if execution hangs.
                  </div>

                  <div
                    onClick={currentTab === "solidity" && soliditySourceMode === "folder" ? browseSolidityFolder : browseLocalFile}
                    style={{
                      border: "1.5px dashed #c7d2fe", borderRadius: 10,
                      padding: "16px 12px", textAlign: "center",
                      background: "#eef2ff", cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: 20, marginBottom: 4 }}>☁</div>
                    <div style={{ fontSize: 11, color: TOKEN.textSub, marginBottom: 7 }}>
                      {currentTab === "solidity" && soliditySourceMode === "folder"
                        ? "Click to select a Solidity folder (.sol files)"
                        : "Drag &amp; drop or click to browse"}
                    </div>
                    <span style={{ fontSize: 11, color: TOKEN.accent, fontWeight: 700, background: TOKEN.bg, border: `1px solid #c7d2fe`, borderRadius: 6, padding: "4px 14px" }}>
                      {currentTab === "solidity" && soliditySourceMode === "folder" ? "Browse Folder" : "Browse File"}
                    </span>
                  </div>

                  {(currentTab === "solidity" && soliditySourceMode === "folder"
                    ? selectedLocalFolderPath
                    : selectedLocalFilePath[currentTab] || selectedSamplePath[currentTab]) && (
                    <div style={{ padding: "7px 10px", borderRadius: 7, border: `1px solid ${TOKEN.border}`, background: TOKEN.bgSurface, fontSize: 10.5, color: TOKEN.textSub, wordBreak: "break-all" }}>
                      {currentTab === "solidity" && soliditySourceMode === "folder" ? "📁" : "📄"} {getFileName(
                        (currentTab === "solidity" && soliditySourceMode === "folder")
                          ? selectedLocalFolderPath
                          : (selectedLocalFilePath[currentTab] || selectedSamplePath[currentTab])
                      )}
                    </div>
                  )}

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <button onClick={loadSamplesForTool} disabled={isLoadingSamples} style={{ ...S.outlineBtn, width: "100%" }}>
                      {isLoadingSamples ? "Loading…" : "📂 Load Sample"}
                    </button>
                    <button
                      onClick={async () => {
                        if (currentTab === "solidity" && soliditySourceMode === "folder") {
                          mockAppendOutput(currentTab, "ℹ Folder selected. View File works only for single-file inputs.");
                          return;
                        }
                        const src = selectedLocalFilePath[currentTab] || selectedSamplePath[currentTab];
                        if (!src) { mockAppendOutput(currentTab, "❌ No file selected."); return; }
                        try {
                          const content = await window.electronAPI?.readFile(src);
                          setFileViewerContent(content || "");
                          setFileViewerLanguage(currentTab);
                          setFileViewerOpen(true);
                        } catch (error) {
                          mockAppendOutput(currentTab, `❌ Error reading file: ${error instanceof Error ? error.message : "Unknown error"}`);
                        }
                      }}
                      style={{ ...S.outlineBtn, width: "100%" }}
                    >
                      <FiEye size={13} /> View File
                    </button>
                  </div>

                  <ActionButtons />
                </>
              ) : (
                <>
                  <div style={{ background: "#d1fae5", border: "1px solid #6ee7b7", borderRadius: 8, padding: "7px 10px", fontSize: 11, color: "#065f46", lineHeight: 1.5 }}>
                    ✅ Write or paste your code below, select a security tool, and click Execute to analyze it.
                  </div>
                  <div style={{ background: "#fef3c7", border: "1px solid #f59e0b", borderRadius: 8, padding: "7px 10px", fontSize: 11, color: "#92400e", lineHeight: 1.5 }}>
                    ⚠️ Make sure there are no infinite loops in your code. Use the Stop button if execution hangs.
                  </div>
                  <Suspense fallback={<div style={{ height: 160, background: TOKEN.bgDeep, borderRadius: 8 }} />}>
                    <CodeEditor
                      code={userCode[currentTab]}
                      language={currentTab}
                      onCodeChange={(code: string) => setUserCode((prev) => ({ ...prev, [currentTab]: code }))}
                      onExecute={() => executeCommand(currentTab)}
                      onStop={() => stopExecution("Stopped")}
                      isExecuting={loading}
                      toolSelected={inputMode === "code" ? true : Boolean(currentTool)}
                      onCompile={() => compileCode(currentTab)}
                      isCompiling={isCompiling}
                    />
                  </Suspense>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Right Panel: Modern Terminal ── */}
        <div
          style={{
            background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
            borderRadius: 16,
            border: "1px solid rgba(148, 163, 184, 0.15)",
            display: "flex", flexDirection: "column",
            overflow: "hidden",
            boxShadow: TOKEN.shadowXl,
          }}
        >
          {/* Terminal header with glassmorphism */}
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid rgba(148, 163, 184, 0.1)",
              display: "flex", alignItems: "center", gap: 8,
              flexShrink: 0,
              background: "rgba(30, 41, 59, 0.5)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }}
          >
            {/* macOS window dots with enhanced styling */}
            <div style={{ display: "flex", gap: 6, flexShrink: 0, marginRight: 6 }}>
              {["#ef4444", "#f59e0b", "#10b981"].map((c, idx) => (
                <div
                  key={c}
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: c,
                    boxShadow: `0 0 8px ${c}50`,
                    cursor: "pointer",
                    transition: "transform 0.2s",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = "scale(1.1)")}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}
                />
              ))}
            </div>

            <span
              style={{
                fontSize: 12, 
                color: "#94a3b8",
                fontFamily: '"JetBrains Mono", monospace', 
                flexShrink: 0,
                fontWeight: 600,
                letterSpacing: "0.02em",
              }}
            >
              Terminal · {currentTab.toUpperCase()}
            </span>

            {(loading || isCompiling) && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10.5,
                  color: "#93c5fd",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                <FaSpinner style={{ animation: "spin 1s linear infinite" }} size={10} />
                {loading ? "Executing..." : "Compiling..."}
              </span>
            )}

            {/* Right-aligned controls */}
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 1 }}>
              {/* Copy */}
              <button onClick={copyToClipboard} style={S.termBtn} >
                <FiCopy size={11} /> Copy
              </button>

              {/* Clear */}
              <button
                onClick={() => setTerminalOutputs((p) => ({ ...p, [currentTab]: "" }))}
                style={S.termBtn}
              >
                Clear
              </button>

              {/* Separator */}
              <span style={{ width: 1, height: 14, background: "#1e293b", margin: "0 4px" }} />

              {/* Stop */}
              <button
                onClick={() => {
                  console.log("[UI] Stop button clicked - loading:", loading, "isCompiling:", isCompiling);
                  // Always allow clicking - stopExecution handles the logic
                  stopExecution("User stopped execution");
                }}
                title={loading || isCompiling ? "Click to stop execution" : "No execution running"}
                style={{
                  ...S.termBtn,
                  color: (loading || isCompiling) ? "#f87171" : "#374151",
                  opacity: (loading || isCompiling) ? 1 : 0.4,
                  cursor: "pointer", // Always allow clicks
                  gap: 4,
                  fontWeight: 600,
                  pointerEvents: "auto", // Always allow clicks
                  transition: "all 0.2s ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = (loading || isCompiling) ? "#ff6b6b" : "#f87171";
                  e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = (loading || isCompiling) ? "#f87171" : "#374151";
                  e.currentTarget.style.opacity = (loading || isCompiling) ? "1" : "0.4";
                }}
              >
                <FiStopCircle size={13} /> Stop
              </button>

              {/* Separator */}
              <span style={{ width: 1, height: 14, background: "#1e293b", margin: "0 4px" }} />

              {/* View Analytics — gradient accent pill */}
              <button
                onClick={() => setDrawerOpen(true)}
                title="View analytics"
                style={{
                  ...S.termBtn,
                  color: "#fff",
                  background: TOKEN.accentGradient,
                  border: "none",
                  borderRadius: 8,
                  padding: "6px 12px",
                  fontWeight: 600,
                  fontSize: 11,
                  gap: 6,
                  boxShadow: "0 4px 12px rgba(99,102,241,0.3)",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow = "0 6px 16px rgba(99,102,241,0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(99,102,241,0.3)";
                }}
              >
                <FiBarChart2 size={13} /> View Analytics
              </button>
            </div>
          </div>

          {/* Terminal body — scrollable */}
          <div
            ref={terminalRef}
            style={{
              flex: 1, minHeight: 0, overflowY: "auto",
              padding: "12px 16px",
              fontSize: 12.5, lineHeight: 1.7,
              background: TOKEN.termBg,
              fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
            }}
          >
            {terminalLines.some((l) => l.trim()) ? (
              terminalLines.map((line, i) => (
                <div
                  key={`${i}-${line}`}
                  style={{
                    display: "flex", gap: 10,
                    padding: "2px 5px", borderRadius: 3, marginBottom: 1,
                    ...getLineStyle(line),
                  }}
                >
                  <span style={{ color: "#374151", flexShrink: 0, fontSize: 9.5, marginTop: 3, userSelect: "none", minWidth: 28, textAlign: "right" }}>
                    {String(i + 1).padStart(3, "0")}
                  </span>
                  <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", flex: 1 }}>
                    {line}
                  </span>
                </div>
              ))
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#374151", fontSize: 12 }}>
                Terminal ready — execute a tool to see output
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Analytics Drawer (30% width, right→left) ── */}
      <AnalyticsDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        chartData={chartData}
        chartType={chartType}
        setChartType={setChartType}
        visualizationTitle={visualizationTitle}
        loading={loading}
        percentageItems={percentageItems}
        onCopyPercentageItem={copyPercentageItem}
      />

      {/* ── Sample Picker Modal ── */}
      <SamplePickerModal
        open={sampleModalOpen}
        title={`Choose sample (${currentTab.toUpperCase()})`}
        samples={sampleOptions[currentTab]}
        onClose={() => setSampleModalOpen(false)}
        onSelect={(sample) => {
          setSelectedSamplePath((prev) => ({ ...prev, [currentTab]: sample.path }));
          setSelectedLocalFilePath((prev) => ({ ...prev, [currentTab]: "" }));
          if (currentTab === "solidity") {
            setSelectedLocalFolderPath("");
            setSoliditySourceMode("file");
          }
          setSampleModalOpen(false);
          mockAppendOutput(currentTab, `✅ Selected sample: ${sample.name}`);
        }}
      />

      {/* ── File Viewer Modal ── */}
      {fileViewerOpen && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 9999,
        }} onClick={() => setFileViewerOpen(false)}>
          <div style={{
            background: "#ffffff", borderRadius: 12, width: "90%", maxWidth: "900px",
            maxHeight: "85vh", display: "flex", flexDirection: "column",
            boxShadow: "0 20px 25px -5px rgba(0,0,0,0.3)",
            overflow: "hidden",
          }} onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: "16px 20px", borderBottom: "1px solid #e5e7eb",
              display: "flex", justifyContent: "space-between", alignItems: "center",
              background: "#f9fafb",
            }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: "#1f2937" }}>
                📄 File Content ({fileViewerLanguage.toUpperCase()})
              </h3>
              <button
                onClick={() => setFileViewerOpen(false)}
                style={{
                  background: "none", border: "none", fontSize: 20, cursor: "pointer",
                  color: "#6b7280", padding: 0,
                }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body — Code Display */}
            <div style={{
              flex: 1, overflow: "auto", background: "#f3f4f6", padding: 0,
            }}>
              <SyntaxHighlighter
                language={fileViewerLanguage}
                style={oneLight}
                customStyle={{
                  margin: 0, background: "#f3f4f6", fontSize: 12,
                  lineHeight: 1.5, fontFamily: '"JetBrains Mono", monospace',
                }}
              >
                {fileViewerContent}
              </SyntaxHighlighter>
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: "12px 20px", borderTop: "1px solid #e5e7eb",
              background: "#f9fafb", display: "flex", gap: 8, justifyContent: "flex-end",
            }}>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(fileViewerContent);
                  mockAppendOutput(currentTab, "✅ Copied to clipboard");
                }}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "1px solid #d1d5db",
                  background: "#ffffff", color: "#374151", cursor: "pointer",
                  fontSize: 13, fontWeight: 500,
                }}
              >
                📋 Copy Content
              </button>
              <button
                onClick={() => setFileViewerOpen(false)}
                style={{
                  padding: "8px 16px", borderRadius: 6, border: "none",
                  background: "#3b82f6", color: "#ffffff", cursor: "pointer",
                  fontSize: 13, fontWeight: 500,
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}