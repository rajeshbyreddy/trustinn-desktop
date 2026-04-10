import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn, execFileSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_ROOT = process.env.TRUSTINN_ROOT || "/home/rajesh";

const TOOL_CONFIG = {
  c: {
    "Condition Satisfiability Analysis": {
      rootDir: "CC-BOUNDED MODEL CHECKER",
      script: "cbmc_script.sh"
    },
    "DSE based Mutation Analyser": {
      rootDir: "DSE_MUTATION_ANALYSER",
      script: "KLEEMA.sh"
    },
    "Dynamic Symbolic Execution": {
      rootDir: "DYNAMIC_SYMBOLIC_EXECUTION",
      script: "KLEE.sh"
    },
    "Dynamic Symbolic Execution with Pruning": {
      rootDir: "DSE_WITH_PRUNING",
      script: "tx.sh"
    },
    "Advance Code Coverage Profiler": {
      rootDir: "ADVANCE_CODE_COVERAGE_PROFILER",
      script: "main-gProfiler.sh",
      sampleDir: "Programs/GCOV"
    },
    "Mutation Testing Profiler": {
      rootDir: "MUTATION_TESTING_PROFILER",
      script: "main-gProfiler.sh"
    }
  },
  java: {
    JBMC: {
      rootDir: "JAVA",
      script: "shellsc.sh"
    }
  },
  python: {
    "Condition Coverage Fuzzing": {
      rootDir: "PYTHON",
      script: "shellpy.sh",
      sampleDir: "SAMPLES"
    }
  },
  solidity: {
    VeriSol: {
      rootDir: "SOLIDITY",
      script: "latest.sh"
    }
  }
};

const EXTENSIONS = {
  c: [".c"],
  java: [".java"],
  python: [".py"],
  solidity: [".sol"]
};

const OUTPUT_DIR_PATTERN = /\/(results?|outputs?|reports?|logs?|temp|tmp|tc|klee-out|dist|build)\//i;
const OUTPUT_NAME_PATTERN = /(results?|outputs?|reports?|logs?|temp|tmp|tc|klee-out|coverage|mutant)/i;
const STRICT_CLEAN_TOOLS = new Set(["DSE based Mutation Analyser"]);
const DOCKER_IMAGE = process.env.TRUSTINN_DOCKER_IMAGE || "rajeshbyreddy95/trustinn-tools:2.0.1";
const USE_DOCKER_RUNTIME = true;
const CONTAINER_RESULTS_ROOT = "/results";
const HOST_TRUSTINN_ROOT = "/mnt/d/TRUSTINN";
const CONTAINER_TRUSTINN_ROOT = "/mnt/d/TRUSTINN";

function getToolConfig(language, tool) {
  const byLanguage = TOOL_CONFIG[language];
  if (!byLanguage || !byLanguage[tool]) {
    throw new Error(`Tool config not found for ${language}: ${tool}`);
  }
  return byLanguage[tool];
}

function resolveToolRoot(rootDir) {
  return path.join(BASE_ROOT, rootDir);
}

function resolveSampleRoot(toolRoot, sampleDir) {
  if (!sampleDir) return toolRoot;
  const configured = path.join(toolRoot, sampleDir);
  return fs.existsSync(configured) ? configured : toolRoot;
}

function safeReadDir(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function collectFilesRecursive(dirPath, allowedExtensions, depth = 0, maxDepth = 7) {
  if (!fs.existsSync(dirPath) || depth > maxDepth) return [];
  const entries = safeReadDir(dirPath);
  let files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(collectFilesRecursive(fullPath, allowedExtensions, depth + 1, maxDepth));
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      files.push({ name: entry.name, path: fullPath });
    }
  }

  return files;
}

function getSampleList(language, tool) {
  try {
    const config = getToolConfig(language, tool);
    const toolRoot = resolveToolRoot(config.rootDir);
    if (!fs.existsSync(toolRoot)) {
      throw new Error(`Tool directory not found: ${toolRoot}`);
    }

    const allowedExtensions = EXTENSIONS[language] || [];
    const sampleRoot = resolveSampleRoot(toolRoot, config.sampleDir);

    let files = collectFilesRecursive(sampleRoot, allowedExtensions);
    if (files.length === 0 && sampleRoot !== toolRoot) {
      files = collectFilesRecursive(toolRoot, allowedExtensions);
    }

    files = files.filter((entry) => !OUTPUT_DIR_PATTERN.test(entry.path.replace(/\\/g, "/")));

    const seen = new Set();
    files = files.filter((entry) => {
      if (seen.has(entry.path)) return false;
      seen.add(entry.path);
      return true;
    });

    return files;
  } catch (err) {
    console.error("list-samples failed:", err.message);
    return [];
  }
}

function buildArgs(tool, samplePath, params = {}) {
  if (tool === "Condition Satisfiability Analysis") {
    return [samplePath, params.cbmcBound].filter(Boolean);
  }
  if (tool === "DSE based Mutation Analyser") {
    return [samplePath, params.kleemaValue].filter(Boolean);
  }
  if (tool === "Advance Code Coverage Profiler") {
    const baseName = path.basename(samplePath);
    const stem = baseName.replace(/\.c(\.|$)/i, "").replace(/\.[^.]+$/, "");
    return [stem || baseName, params.gmcovVersion, params.gmcovTimebound].filter(Boolean);
  }
  if (tool === "Mutation Testing Profiler") {
    return [samplePath, params.gmutantVersion, params.gmutantTimebound].filter(Boolean);
  }
  if (tool === "VeriSol") {
    return [samplePath, params.solidityMode].filter(Boolean);
  }
  return [samplePath].filter(Boolean);
}

function sanitizeSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getSampleStem(samplePath) {
  return path.basename(samplePath).replace(/\.[^.]+$/, "");
}

function isWslEnvironment() {
  return process.platform === "linux" && fs.existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");
}

function windowsPathToWsl(winPath) {
  const normalized = String(winPath || "").trim().replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.+)$/);
  if (!match) return "";
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/^\/+/, "");
  return `/mnt/${drive}/${rest}`;
}

function resolveWslWindowsDownloadsDir() {
  try {
    const userProfile = execFileSync("cmd.exe", ["/C", "echo", "%USERPROFILE%"], {
      encoding: "utf8"
    })
      .replace(/\r/g, "")
      .trim();

    if (userProfile && !/%USERPROFILE%/i.test(userProfile)) {
      const wslUserProfile = windowsPathToWsl(userProfile);
      if (wslUserProfile && fs.existsSync(wslUserProfile)) {
        return path.join(wslUserProfile, "Downloads");
      }
    }
  } catch {
    // Ignore and use fallback.
  }

  return "/mnt/c/Users/Public/Downloads";
}

function toDisplayPath(targetPath) {
  if (isWslEnvironment()) {
    const normalized = String(targetPath || "").replace(/\\/g, "/");
    const match = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (match) {
      const drive = match[1].toUpperCase();
      const rest = match[2].replace(/\//g, "\\");
      return `${drive}:\\${rest}`;
    }
  }
  return targetPath;
}

function getTrustinnDownloadsRoot() {
  return "/mnt/c/Users/Public/Downloads/TrustinnDownloads";
}

function getContainerOutputDir(tool, samplePath) {
  return path.join(
    getTrustinnDownloadsRoot(),
    sanitizeSegment(tool) || "tool",
    sanitizeSegment(getSampleStem(samplePath)) || "sample"
  );
}

function getDockerArgs(extraArgs = []) {
  const outputRoot = getTrustinnDownloadsRoot();
  fs.mkdirSync(outputRoot, { recursive: true });

  const dockerArgs = [
    "run",
    "--rm",
    "-i",
    "-v",
    `${outputRoot}:${CONTAINER_RESULTS_ROOT}`
  ];

  if (fs.existsSync(HOST_TRUSTINN_ROOT)) {
    dockerArgs.push("-v", `${HOST_TRUSTINN_ROOT}:${CONTAINER_TRUSTINN_ROOT}`);
  }

  dockerArgs.push(DOCKER_IMAGE, ...extraArgs);
  return dockerArgs;
}

function remapContainerOutput(text) {
  if (!text) return text;
  const localRoot = getTrustinnDownloadsRoot().replace(/\\/g, "/");
  return text.replace(/\/results\//g, `${localRoot}/`);
}

function getSampleListDocker(language, tool) {
  try {
    const args = getDockerArgs([
      "list-samples",
      "--language",
      language,
      "--tool",
      tool
    ]);

    const raw = execFileSync("docker", args, {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024
    });

    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("docker list-samples failed:", err.message);
    return [];
  }
}

function snapshotTopLevelEntries(dirPath) {
  const snapshot = new Map();
  for (const entry of safeReadDir(dirPath)) {
    const entryPath = path.join(dirPath, entry.name);
    try {
      const stats = fs.statSync(entryPath);
      snapshot.set(entry.name, stats.mtimeMs);
    } catch {
      // Skip inaccessible entries.
    }
  }
  return snapshot;
}

function moveEntry(srcPath, destPath) {
  try {
    fs.renameSync(srcPath, destPath);
    return;
  } catch {
    // Cross-device rename fallback.
  }

  const stats = fs.statSync(srcPath);
  if (stats.isDirectory()) {
    fs.cpSync(srcPath, destPath, { recursive: true, force: true });
    fs.rmSync(srcPath, { recursive: true, force: true });
  } else {
    fs.copyFileSync(srcPath, destPath);
    fs.rmSync(srcPath, { force: true });
  }
}

function getUniqueDestination(destPath) {
  if (!fs.existsSync(destPath)) return destPath;

  const dir = path.dirname(destPath);
  const ext = path.extname(destPath);
  const base = path.basename(destPath, ext);
  let counter = 1;

  while (true) {
    const candidate = path.join(dir, `${base}-${counter}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    counter += 1;
  }
}

function ensureRequiredToolDirs(config, toolRoot) {
  if (config.rootDir !== "ADVANCE_CODE_COVERAGE_PROFILER") return;

  const requiredDirs = ["CBMC", "Programs", "SequenceGenerator"];
  const fallbackRoots = [
    path.join(BASE_ROOT, "TRUSTINN", "TRUSTINN", config.rootDir)
  ];

  for (const dirName of requiredDirs) {
    const targetDir = path.join(toolRoot, dirName);
    if (fs.existsSync(targetDir)) continue;

    for (const fallbackRoot of fallbackRoots) {
      const sourceDir = path.join(fallbackRoot, dirName);
      if (!fs.existsSync(sourceDir)) continue;
      fs.cpSync(sourceDir, targetDir, { recursive: true, force: true });
      break;
    }
  }

  const missing = requiredDirs.filter((dirName) => !fs.existsSync(path.join(toolRoot, dirName)));
  if (missing.length > 0) {
    throw new Error(`Missing required directories in ${config.rootDir}: ${missing.join(", ")}`);
  }
}

function isSourceLikeEntry(entryName) {
  const ext = path.extname(entryName).toLowerCase();
  return [".c", ".java", ".py", ".sol", ".sh", ".txt", ".md"].includes(ext);
}

function relocateArtifacts(toolRoot, tool, samplePath, beforeSnapshot) {
  const sampleStem = getSampleStem(samplePath).toLowerCase();
  const strictCleanMode = STRICT_CLEAN_TOOLS.has(tool);
  const candidates = [];

  for (const entry of safeReadDir(toolRoot)) {
    const entryPath = path.join(toolRoot, entry.name);
    let currentMtimeMs = 0;
    try {
      currentMtimeMs = fs.statSync(entryPath).mtimeMs;
    } catch {
      continue;
    }

    const previousMtimeMs = beforeSnapshot.get(entry.name);
    const isNew = previousMtimeMs === undefined;
    const isModified = previousMtimeMs !== undefined && currentMtimeMs > previousMtimeMs + 1;
    const changed = isNew || isModified;

    const lowered = entry.name.toLowerCase();
    const sampleMatch = sampleStem && lowered.includes(sampleStem);
    const outputMatch = OUTPUT_NAME_PATTERN.test(lowered);
    const looksGenerated = outputMatch || (sampleMatch && !isSourceLikeEntry(entry.name));
    if (!looksGenerated) continue;
    if (!strictCleanMode && !changed) continue;

    candidates.push(entry);
  }

  if (candidates.length === 0) {
    return { outputDir: null, movedArtifacts: [] };
  }

  const outputDir = path.join(
    getTrustinnDownloadsRoot(),
    sanitizeSegment(tool) || "tool",
    sanitizeSegment(getSampleStem(samplePath)) || "sample"
  );

  fs.mkdirSync(outputDir, { recursive: true });

  const movedArtifacts = [];
  for (const entry of candidates) {
    const srcPath = path.join(toolRoot, entry.name);
    const destPath = getUniqueDestination(path.join(outputDir, entry.name));
    try {
      moveEntry(srcPath, destPath);
      movedArtifacts.push(destPath);
    } catch (err) {
      console.warn(`Failed to move artifact ${entry.name}: ${err.message}`);
    }
  }

  if (strictCleanMode) {
    for (const entry of safeReadDir(toolRoot)) {
      const lowered = entry.name.toLowerCase();
      const sampleMatch = sampleStem && lowered.includes(sampleStem);
      const outputMatch = OUTPUT_NAME_PATTERN.test(lowered);
      const looksGenerated = outputMatch || (sampleMatch && !isSourceLikeEntry(entry.name));
      if (!looksGenerated) continue;

      const sourcePath = path.join(toolRoot, entry.name);
      if (!fs.existsSync(sourcePath)) continue;
      try {
        fs.rmSync(sourcePath, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  return { outputDir, movedArtifacts };
}

async function runTool(event, language, tool, samplePath, params) {
  if (USE_DOCKER_RUNTIME) {
    const outputDir = getContainerOutputDir(tool, samplePath);
    const args = getDockerArgs([
      "run-tool",
      "--language",
      language,
      "--tool",
      tool,
      "--sample",
      samplePath,
      "--params",
      JSON.stringify(params || {})
    ]);

    return await new Promise((resolve) => {
      const child = spawn("docker", args);
      let output = "";

      child.stdout.on("data", (data) => {
        const chunk = remapContainerOutput(data.toString());
        output += chunk;
        event?.sender?.send("tool-output", { type: "stdout", data: chunk });
      });

      child.stderr.on("data", (data) => {
        const chunk = remapContainerOutput(data.toString());
        output += chunk;
        event?.sender?.send("tool-output", { type: "stderr", data: chunk });
      });

      child.on("close", (code) => {
        event?.sender?.send("tool-output", {
          type: "completion",
          data: code === 0 ? "\n✓ Execution completed" : `\n✗ Execution failed (${code})`
        });

        resolve({
          ok: code === 0,
          code,
          output,
          outputDir,
          movedArtifacts: []
        });
      });

      child.on("error", (err) => {
        const msg = `Error: ${err.message}`;
        event?.sender?.send("tool-output", { type: "stderr", data: msg });
        resolve({ ok: false, code: 1, output: msg, outputDir, movedArtifacts: [] });
      });
    });
  }

  const config = getToolConfig(language, tool);
  const toolRoot = resolveToolRoot(config.rootDir);
  const scriptPath = path.join(toolRoot, config.script);

  ensureRequiredToolDirs(config, toolRoot);

  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }
  if (!fs.existsSync(samplePath)) {
    throw new Error(`Sample not found: ${samplePath}`);
  }

  const args = buildArgs(tool, samplePath, params);
  const beforeSnapshot = snapshotTopLevelEntries(toolRoot);

  return await new Promise((resolve) => {
    const child = spawn("bash", [scriptPath, ...args], {
      cwd: toolRoot
    });

    let output = "";

    child.stdout.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      event?.sender?.send("tool-output", { type: "stdout", data: chunk });
    });

    child.stderr.on("data", (data) => {
      const chunk = data.toString();
      output += chunk;
      event?.sender?.send("tool-output", { type: "stderr", data: chunk });
    });

    child.on("close", (code) => {
      const relocation = relocateArtifacts(toolRoot, tool, samplePath, beforeSnapshot);
      if (relocation.outputDir && relocation.movedArtifacts.length > 0) {
        const movedNote = `\nResults moved to: ${toDisplayPath(relocation.outputDir)}\n`;
        output += movedNote;
        event?.sender?.send("tool-output", { type: "stdout", data: movedNote });
      }

      event?.sender?.send("tool-output", {
        type: "completion",
        data: code === 0 ? "\n✓ Execution completed" : `\n✗ Execution failed (${code})`
      });
      resolve({
        ok: code === 0,
        code,
        output,
        outputDir: relocation.outputDir,
        movedArtifacts: relocation.movedArtifacts
      });
    });

    child.on("error", (err) => {
      event?.sender?.send("tool-output", { type: "stderr", data: `Error: ${err.message}` });
      resolve({ ok: false, code: 1, output: err.message });
    });
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    backgroundColor: "#f8fafc",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs")
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  ipcMain.handle("list-samples", async (_event, payload) => {
    if (USE_DOCKER_RUNTIME) {
      return getSampleListDocker(payload.language, payload.tool);
    }
    return getSampleList(payload.language, payload.tool);
  });

  ipcMain.handle("run-tool", async (event, payload) => {
    return runTool(event, payload.language, payload.tool, payload.samplePath, payload.params);
  });

  ipcMain.handle("open-file-dialog", async (_event, payload) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Select ${payload.language.toUpperCase()} file`,
      defaultPath: BASE_ROOT,
      filters: [
        { name: "Source Files", extensions: [payload.extension || "c"] },
        { name: "All Files", extensions: ["*"] }
      ],
      properties: ["openFile"]
    });
    return result.filePaths.length > 0 ? result.filePaths[0] : null;
  });

  ipcMain.handle("open-downloads", async () => {
    const downloadPath = getTrustinnDownloadsRoot();
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }
    await shell.openPath(downloadPath);
    return downloadPath;
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
