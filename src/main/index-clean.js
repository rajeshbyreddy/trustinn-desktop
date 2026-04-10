import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path from "path";
import os from "os";
import fs from "fs";
import { fileURLToPath } from "url";
import { spawn, execSync, execFileSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BASE_ROOT = process.env.TRUSTINN_ROOT || "/home/rajesh";

const TOOL_CONFIG = {
  c: {
    "Condition Satisfiability Analysis": { rootDir: "CC-BOUNDED MODEL CHECKER", script: "cbmc_script.sh" },
    "DSE based Mutation Analyser": { rootDir: "DSE_MUTATION_ANALYSER", script: "KLEEMA.sh" },
    "Dynamic Symbolic Execution": { rootDir: "DYNAMIC_SYMBOLIC_EXECUTION", script: "KLEE.sh" },
    "Dynamic Symbolic Execution with Pruning": { rootDir: "DSE_WITH_PRUNING", script: "tx.sh" },
    "Advance Code Coverage Profiler": { rootDir: "ADVANCE_CODE_COVERAGE_PROFILER", script: "main-gProfiler.sh", sampleDir: "Programs/GCOV" },
    "Mutation Testing Profiler": { rootDir: "MUTATION_TESTING_PROFILER", script: "main-gProfiler.sh" }
  },
  java: { "JBMC": { rootDir: "JAVA", script: "shellsc.sh" } },
  python: { "Condition Coverage Fuzzing": { rootDir: "PYTHON", script: "shellpy.sh", sampleDir: "SAMPLES" } },
  solidity: { "VeriSol": { rootDir: "SOLIDITY", script: "latest.sh" }}
};

const EXTENSIONS = { c: [".c"], java: [".java"], python: [".py"], solidity: [".sol"] };
const OUTPUT_NAME_PATTERN = /(results?|outputs?|reports?|logs?|temp|tmp|tc|klee-out|coverage|mutant)/i;
const STRICT_CLEAN_TOOLS = new Set(["DSE based Mutation Analyser"]);

// Helper functions
const getToolConfig = (lang, tool) => {
  const g = TOOL_CONFIG[lang];
  if (!g || !g[tool]) throw new Error("Tool config not found.");
  return g[tool];
};

const resolveToolRoot = (rootDir) => path.join(BASE_ROOT, rootDir);
const resolveSampleRoot = (toolRoot, sampleDir) => {
  if (!sampleDir) return toolRoot;
  const d = path.join(toolRoot, sampleDir);
  return fs.existsSync(d) ? d : toolRoot;
};

const safeReadDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) return [];
  try { return fs.readdirSync(dirPath, { withFileTypes: true }); } 
  catch { return []; }
};

const collectFilesRecursive = (dirPath, allowedExts, depth = 0) => {
  if (!fs.existsSync(dirPath) || depth > 6) return [];
  const entries = safeReadDir(dirPath);
  let results = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(collectFilesRecursive(fullPath, allowedExts, depth + 1));
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (allowedExts.includes(ext)) {
        results.push({ name: entry.name, path: fullPath });
      }
    }
  }
  return results;
};

const sanitizeSegment = (value) => String(value || "")
  .trim()
  .replace(/[\\/:*?"<>|]/g, "-")
  .replace(/\s+/g, "-")
  .replace(/-+/g, "-")
  .replace(/^-|-$/g, "");

const getSampleStem = (samplePath) => path.basename(samplePath).replace(/\.[^.]+$/, "");

const isWslEnvironment = () => process.platform === "linux" && fs.existsSync("/proc/sys/fs/binfmt_misc/WSLInterop");

const windowsPathToWsl = (winPath) => {
  const normalized = String(winPath || "").trim().replace(/\\/g, "/");
  const match = normalized.match(/^([A-Za-z]):\/(.+)$/);
  if (!match) return "";
  const drive = match[1].toLowerCase();
  const rest = match[2].replace(/^\/+/, "");
  return `/mnt/${drive}/${rest}`;
};

const resolveWslWindowsDownloadsDir = () => {
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
};

const toDisplayPath = (targetPath) => {
  if (isWslEnvironment()) {
    const normalized = String(targetPath || "").replace(/\\/g, "/");
    const match = normalized.match(/^\/mnt\/([a-zA-Z])\/(.*)$/);
    if (match) {
      const drive = match[1].toUpperCase();
      const rest = match[2].replace(/\//g, "\\");
      return `${drive}:\\${rest}`;
    }
  }

  const homePath = os.homedir();
  if (targetPath && homePath && targetPath.startsWith(homePath)) {
    return targetPath.replace(homePath, "~");
  }
  return targetPath;
};

const getTrustinnDownloadsRoot = () => {
  if (isWslEnvironment()) {
    return path.join(resolveWslWindowsDownloadsDir(), "TrustinnDownloads");
  }

  const downloadsPath = path.join(os.homedir(), "Downloads");
  return path.join(downloadsPath, "TrustinnDownloads");
};

const snapshotTopLevelEntries = (dirPath) => {
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
};

const moveEntry = (srcPath, destPath) => {
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
};

const getUniqueDestination = (destPath) => {
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
};

const ensureRequiredToolDirs = (config, toolRoot) => {
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
};

const isSourceLikeEntry = (entryName) => {
  const ext = path.extname(entryName).toLowerCase();
  return [".c", ".java", ".py", ".sol", ".sh", ".txt", ".md"].includes(ext);
};

const relocateArtifacts = (toolRoot, tool, samplePath, beforeSnapshot) => {
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
};

let mainWindow = null;

const setupIPCHandlers = () => {
  ipcMain.handle("list-samples", (_event, payload) => {
    try {
      console.log(`[IPC] list-samples: ${payload.language}/${payload.tool}`);
      const config = getToolConfig(payload.language, payload.tool);
      const toolRoot = resolveToolRoot(config.rootDir);
      if (!fs.existsSync(toolRoot)) throw new Error("Tool not found: " + toolRoot);
      
      const sampleRoot = resolveSampleRoot(toolRoot, config.sampleDir);
      let files = collectFilesRecursive(sampleRoot, EXTENSIONS[payload.language] || []);
      
      const isOutputPath = (fp) => /\/(results?|outputs?|reports?|logs?|temp|tmp|tc|test[-_ ]?cases?)\//.test(fp.toLowerCase());
      files = files.filter((e) => !isOutputPath(e.path));
      
      const seen = new Set();
      files = files.filter((e) => {
        if (seen.has(e.path)) return false;
        seen.add(e.path);
        return true;
      });
      
      console.log(`[IPC] Found ${files.length} samples`);
      return files;
    } catch (err) {
      console.error("[IPC] list-samples error:", err.message);
      return [];
    }
  });

  ipcMain.handle("run-tool", async (event, payload) => {
    try {
      const config = getToolConfig(payload.language, payload.tool);
      const toolRoot = resolveToolRoot(config.rootDir);
      const scriptPath = path.join(toolRoot, config.script);
      ensureRequiredToolDirs(config, toolRoot);
      if (!fs.existsSync(scriptPath)) throw new Error("Script not found: " + scriptPath);
      if (!fs.existsSync(payload.samplePath)) throw new Error("Sample not found: " + payload.samplePath);
      const beforeSnapshot = snapshotTopLevelEntries(toolRoot);
      
      return await new Promise((resolve) => {
        const child = spawn("bash", [scriptPath, payload.samplePath], { cwd: toolRoot });
        let output = "";
        child.stdout.on("data", (data) => {
          const chunk = data.toString();
          output += chunk;
          if (event?.sender) event.sender.send("tool-output", { type: "stdout", data: chunk });
        });
        child.stderr.on("data", (data) => {
          const chunk = data.toString();
          output += chunk;
          if (event?.sender) event.sender.send("tool-output", { type: "stderr", data: chunk });
        });
        child.on("close", (code) => {
          const relocation = relocateArtifacts(toolRoot, payload.tool, payload.samplePath, beforeSnapshot);
          if (relocation.outputDir && relocation.movedArtifacts.length > 0) {
            const movedNote = `\nResults moved to: ${toDisplayPath(relocation.outputDir)}\n`;
            output += movedNote;
            if (event?.sender) event.sender.send("tool-output", { type: "stdout", data: movedNote });
          }
          if (event?.sender) event.sender.send("tool-output", { type: "completion", data: code === 0 ? "\n✓ Done" : `\n✗ Failed (${code})` });
          resolve({ ok: code === 0, code, output, outputDir: relocation.outputDir, movedArtifacts: relocation.movedArtifacts });
        });
        child.on("error", (err) => {
          if (event?.sender) event.sender.send("tool-output", { type: "stderr", data: `Error: ${err.message}` });
          resolve({ ok: false, code: 1, output: err.message });
        });
      });
    } catch (err) {
      console.error("[IPC] run-tool error:", err.message);
      throw err;
    }
  });

  ipcMain.handle("open-file-dialog", async (_event, payload) => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: `Select a ${payload.language} file`,
        defaultPath: BASE_ROOT,
        filters: [{ name: `${payload.language.toUpperCase()} files`, extensions: [payload.extension] }],
        properties: ["openFile"]
      });
      return result.filePaths.length > 0 ? result.filePaths[0] : null;
    } catch (err) {
      console.error("[IPC] open-file-dialog error:", err.message);
      return null;
    }
  });

  ipcMain.handle("open-downloads", async () => {
    try {
      const downloadPath = getTrustinnDownloadsRoot();
      if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true });
      if (process.platform === "win32") {
        execSync(`explorer "${downloadPath}"`);
      } else if (process.platform === "darwin") {
        execSync(`open "${downloadPath}"`);
      } else {
        execSync(`xdg-open "${downloadPath}"`);
      }
      return downloadPath;
    } catch (err) {
      console.error("[IPC] open-downloads error:", err.message);
      return null;
    }
  });
};

const createWindow = () => {
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
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "..", "dist", "index.html"));
  }
};

app.whenReady().then(() => {
  setupIPCHandlers();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
