/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const setupDocker = require("./setup-docker.cjs");

function normalizeAppRoute(route) {
  if (typeof route !== "string") return "/";
  const trimmed = route.trim();
  if (!trimmed || trimmed === "/") return "/";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

const isDev = !app.isPackaged;
const DEFAULT_IMAGE = process.env.TRUSTINN_IMAGE || "rajeshbyreddy95/trustinn-tools:19.0.0";
const DEFAULT_PLATFORM = process.env.TRUSTINN_PLATFORM || "linux/amd64";
const DEFAULT_RESULTS_DIR = path.join(os.homedir(), "Downloads", "TrustinnDownloads");
const PERSIST_RESULTS_DEFAULT = process.env.TRUSTINN_PERSIST_RESULTS === "1";
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
let activeToolProcess = null;
let activeDockerPullProcess = null;
let isDockerPullCancelled = false;
let mainWindow = null;
let configuredResultsDir = DEFAULT_RESULTS_DIR;
let hasRegisteredStaticAssetRewrite = false;

try {
  setupDocker.parseConfig();
  configuredResultsDir = DEFAULT_RESULTS_DIR;
} catch (error) {
  console.warn("[SETUP] Failed to read startup config:", error instanceof Error ? error.message : String(error));
}

function getFileExtension(language) {
  switch (language) {
    case "java": return "java";
    case "python": return "py";
    case "c": return "c";
    case "solidity": return "sol";
    default: return "txt";
  }
}

function buildDockerRunArgs(tempDir, containerArgs) {
  const workDir = "/workspace";
  return [
    "run",
    "--platform",
    DEFAULT_PLATFORM,
    "--rm",
    "-v",
    `${getDockerVolumePath(tempDir)}:${workDir}:rw`,
    "-w",
    workDir,
    DEFAULT_IMAGE,
    ...containerArgs,
  ];
}

function resolveStaticRouteHtml(route) {
  const normalized = normalizeAppRoute(route);
  const relativePath = normalized === "/"
    ? path.join("out", "index.html")
    : path.join("out", normalized.replace(/^\/+/, ""), "index.html");

  const candidatePaths = [
    path.join(app.getAppPath(), relativePath),
    path.join(process.resourcesPath, "app.asar", relativePath),
    path.join(process.resourcesPath, relativePath),
  ];

  return candidatePaths.find((candidate) => fs.existsSync(candidate)) || "";
}

function rewriteExportedAssetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.startsWith("file://")) {
    return "";
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "";
  }

  const decodedPath = decodeURIComponent(parsed.pathname || "");
  const outMarker = "/out/";
  const outIndex = decodedPath.indexOf(outMarker);
  if (outIndex < 0) return "";

  const afterOut = decodedPath.slice(outIndex + outMarker.length);
  
  // Debug: Log all image requests
  if (afterOut.includes("DemoGallery") || afterOut.includes(".jpg") || afterOut.includes(".png")) {
    console.log("[ASSET_REWRITE] Original path afterOut:", afterOut);
  }
  
  // Handle nested route _next/* assets: rewrite from out/tools/_next/* to out/_next/*.
  const nestedNextMarker = "/_next/";
  const nestedNextIndex = afterOut.indexOf(nestedNextMarker);
  if (nestedNextIndex > 0) {
    const rewrittenPath =
      decodedPath.slice(0, outIndex + outMarker.length) +
      "_next/" +
      afterOut.slice(nestedNextIndex + nestedNextMarker.length);

    if (rewrittenPath !== decodedPath) {
      parsed.pathname = rewrittenPath;
      console.log("[ASSET_REWRITE] Rewritten _next path:", rewrittenPath);
      return parsed.toString();
    }
  }

  // Handle public folder assets from nested routes: rewrite from out/tools/DemoGallery/* to out/DemoGallery/*.
  const pathSegments = afterOut.split("/").filter(Boolean);
  if (pathSegments.length > 1) {
    // List of known public asset directories to check
    const publicDirs = ["DemoGallery"];
    for (const publicDir of publicDirs) {
      if (pathSegments.includes(publicDir)) {
        const pubDirIndex = pathSegments.indexOf(publicDir);
        if (pubDirIndex > 0) {
          // Reconstruct: out/<publicDir>/<rest of path>
          const rewrittenSegments = [pathSegments[pubDirIndex], ...pathSegments.slice(pubDirIndex + 1)];
          const rewrittenPath =
            decodedPath.slice(0, outIndex + outMarker.length) +
            rewrittenSegments.join("/");

          if (rewrittenPath !== decodedPath) {
            parsed.pathname = rewrittenPath;
            console.log("[ASSET_REWRITE] Rewritten public folder path from:", afterOut, "to:", rewrittenPath.slice(rewrittenPath.indexOf(outMarker) + outMarker.length));
            return parsed.toString();
          }
        }
      }
    }
  }

  return "";
}

function registerStaticAssetRewrite(session) {
  if (hasRegisteredStaticAssetRewrite || !session) return;

  session.webRequest.onBeforeRequest({ urls: ["file://*/*"] }, (details, callback) => {
    const url = details.url;
    if (url.includes("DemoGallery") || url.includes("G1") || url.includes("G2") || url.includes("G3") || url.includes("G4") || url.includes("G5") || url.includes("G9") || url.includes("G10") || url.includes("G12") || url.includes("G13")) {
      console.log("[WEBRequest_INTERCEPT] Intercepted URL:", url);
    }
    
    const redirectURL = rewriteExportedAssetUrl(url);
    if (redirectURL) {
      console.log("[WEBREQUEST_REWRITE] Redirecting to:", redirectURL);
      callback({ redirectURL });
      return;
    }
    callback({});
  });

  hasRegisteredStaticAssetRewrite = true;
}

function getDockerVolumePath(hostPath) {
  // Ensure path is always absolute for Docker volumes
  const absolutePath = path.resolve(hostPath);
  
  // On macOS, Docker Desktop handles /Users, /Volumes, and /var mounts
  if (IS_MAC) {
    const homeDir = os.homedir();
    
    // If path is within home directory, it will work with Docker on Mac
    if (absolutePath.startsWith(homeDir)) {
      return absolutePath;
    }
    
    // If path is already a Docker-compatible mount point, use as-is
    if (absolutePath.startsWith("/Volumes") || absolutePath.startsWith("/var")) {
      return absolutePath;
    }
  }
  
  return absolutePath;
}

function runProcess(command, args, options = {}) {
  const trackProcess = Boolean(options.trackProcess);
  const commandTimeout = options.commandTimeout || 0; // 0 = no timeout
  const onData = options.onData; // callback for live output

  return new Promise((resolve, reject) => {
    let resolved = false; // Prevent multiple resolutions
    let killTimeout; // Store timeout ID to clear it
    let lastDataTime = 0; // Throttle live output to prevent UI hangs
    const spawnOptions = {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
      timeout: commandTimeout, // Process timeout if specified
    };

    if (trackProcess && process.platform !== "win32") {
      spawnOptions.detached = true;
    }

    const proc = spawn(command, args, spawnOptions);
    console.log(`[DEBUG] Spawned process pid=${proc.pid}, trackProcess=${trackProcess}, detached=${spawnOptions.detached}, command=${command} ${args.join(" ")}`);

    if (trackProcess) {
      activeToolProcess = proc;
    }

    const MAX_OUTPUT_SIZE = 10 * 1024 * 1024; // 10MB limit to prevent string length errors
    let stdout = "";
    let stderr = "";
    let stdoutChunks = 0;
    let stderrChunks = 0;
    let hasData = false;

    const doResolve = (code, s, e) => {
      if (resolved) return; // Prevent double resolution
      resolved = true;
      
      // Clear the timeout if it exists
      if (killTimeout) {
        clearTimeout(killTimeout);
        killTimeout = null;
      }
      
      if (trackProcess && activeToolProcess === proc) {
        activeToolProcess = null;
      }
      
      console.log(`[DEBUG] Resolving with code ${code}`);
      resolve({ code: code ?? 1, stdout: s, stderr: e });
    };

    proc.stdout.on("data", (chunk) => {
      hasData = true;
      stdoutChunks++;
      const chunkStr = String(chunk);
      if (stdout.length + chunkStr.length <= MAX_OUTPUT_SIZE) {
        stdout += chunkStr;
      } else if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += chunkStr.substring(0, MAX_OUTPUT_SIZE - stdout.length);
        stdout += '\n[Output truncated due to size limit]';
      }
      // Send live output if callback provided, throttled to prevent UI hangs
      const now = Date.now();
      if (onData && now - lastDataTime > 50) { // Send at most every 50ms
        onData('stdout', chunkStr);
        lastDataTime = now;
      }
      // Log first chunk for ACCP
      if (stdoutChunks === 1 && stdout.includes("NITMiner Technologies")) {
        console.log(`[DEBUG] First stdout chunk received for ACCP tool`);
      }
    });

    proc.stderr.on("data", (chunk) => {
      hasData = true;
      stderrChunks++;
      const chunkStr = String(chunk);
      if (stderr.length + chunkStr.length <= MAX_OUTPUT_SIZE) {
        stderr += chunkStr;
      } else if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += chunkStr.substring(0, MAX_OUTPUT_SIZE - stderr.length);
        stderr += '\n[Output truncated due to size limit]';
      }
      // Send live output if callback provided, throttled to prevent UI hangs
      const now = Date.now();
      if (onData && now - lastDataTime > 50) { // Send at most every 50ms
        onData('stderr', chunkStr);
        lastDataTime = now;
      }
    });

    proc.on("exit", (code, signal) => {
      console.log(`[DEBUG] Process exited - code: ${code}, signal: ${signal}`);
    });

    proc.on("error", (error) => {
      console.error("[DEBUG] Process error:", error.message);
      
      // Clear timeout on error
      if (killTimeout) {
        clearTimeout(killTimeout);
        killTimeout = null;
      }
      
      if (!resolved) {
        resolved = true;
        reject(error);
      }
    });

    proc.on("close", (code) => {
      // Log for debugging ACCP issues
      if (stdout.includes("NITMiner Technologies")) {
        console.log(`[DEBUG] Process closed - code: ${code}, hasData: ${hasData}, stdout chunks: ${stdoutChunks}, length: ${stdout.length}, stderr chunks: ${stderrChunks}, length: ${stderr.length}`);
        const firstLine = stdout.split("\n")[0];
        const lastLine = stdout.split("\n").pop();
        console.log(`[DEBUG] First output line: ${firstLine?.substring(0, 100)}`);
        console.log(`[DEBUG] Last output line: ${lastLine?.substring(0, 100)}`);
        if (stderr) console.log(`[DEBUG] stderr: ${stderr.substring(0, 500)}`);
      }
      doResolve(code ?? 1, stdout, stderr);
    });

    // Auto-kill process if timeout exceeded - more aggressive termination
    if (commandTimeout > 0) {
      killTimeout = setTimeout(() => {
        if (proc && !proc.killed) {
          const pid = proc.pid;
          console.log(`[DEBUG] Process timeout after ${commandTimeout}ms, killing PID ${pid} with SIGKILL`);
          
          try {
            // First try SIGKILL on the process
            proc.kill("SIGKILL");
            
            // Also kill any child processes (for compound commands)
            if (process.platform === "darwin" || process.platform === "linux") {
              try {
                require("child_process").execSync(`kill -9 -${pid} 2>/dev/null || true`, { 
                  stdio: "ignore",
                  timeout: 1000 
                });
              } catch (e) {
                // Ignore - process might already be dead
              }
            }
            
            // Force close IMMEDIATELY after 500ms if still not closed
            setTimeout(() => {
              if (!resolved) {
                console.log(`[DEBUG] Force-resolving after kill timeout`);
                doResolve(137, stdout, stderr); // 137 = killed by SIGKILL
              }
            }, 500);
          } catch (err) {
            console.error(`[DEBUG] Failed to kill process: ${err.message}`);
            if (!resolved) {
              doResolve(1, stdout, stderr);
            }
          }
        }
      }, commandTimeout);
    }
  });
}

function isDockerErrorMessage(message) {
  if (!message) return false;
  const msg = String(message).toLowerCase();
  return msg.includes("docker") || 
         msg.includes(".docker/run/docker.sock") ||
         msg.includes(".docker") ||
         msg.includes("cannot find") ||
         msg.includes("enoent") ||
         msg.includes("dial unix") ||
         msg.includes("connect: no such file") ||
         msg.includes("failed to connect to the docker api") ||
         msg.includes("mounts denied") ||
         msg.includes("path is not shared from the host");
}

function showDockerErrorModal() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    let title = "Docker Not Running";
    let message = "Docker daemon is not running or not installed. Please start Docker Desktop and try again.\n\nMake sure Docker is properly installed and the daemon is running on your system.";
    
    if (IS_MAC) {
      title = "Docker File Sharing Issue";
      message = "The path is not shared with Docker. Please configure file sharing:\n\n1. Open Docker Desktop\n2. Go to Preferences → Resources → File Sharing\n3. Add the '/Users' directory\n4. Click Apply and Restart\n\nThen try again.";
    }
    
    dialog.showErrorBox(title, message);
  }
}

function handleDockerError(error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  
  if (isDockerErrorMessage(errorMessage)) {
    showDockerErrorModal();
  }
  
  return errorMessage;
}

function paramsForTool(tool) {
  switch (tool) {
    case "Condition Satisfiability Analysis":
      return "{cbmcBound:10}";
    case "DSE based Mutation Analyser":
      return "{kleemaValue:3}";
    case "Dynamic Symbolic Execution":
      return "{}";
    case "Dynamic Symbolic Execution with Pruning":
      return "{}";
    case "Advance Code Coverage Profiler":
      return "{gmcovVersion:4,gmcovTimebound:1200}";
    case "Mutation Testing Profiler":
      return "{gmutantVersion:4,gmutantTimebound:60}";
    default:
      return "{}";
  }
}

function paramsForLanguageTool(language, tool, params) {
  if (params) return params;

  if (language === "solidity") {
    return "{solidityMode:bmc}";
  }

  return paramsForTool(tool);
}

function sampleCandidates(tool, items) {
  const paths = items.map((item) => item.path).filter(Boolean);
  const ordered = [];
  const seen = new Set();

  const isMutationArtifact = (p) => {
    const fileName = path.basename(p);
    return (
      fileName.includes("Mutant") ||
      /Line_\d+_Pred/.test(fileName) ||
      fileName.startsWith("AOF_") ||
      fileName.startsWith("ROF_") ||
      fileName.startsWith("PNF_")
    );
  };

  const isAdvancedCoverageExcluded = (p) => {
    return (
      p.includes("/Programs/GCOV/") ||
      p.includes("/Programs/CBMC/") ||
      p.includes("-RESULTS-") ||
      p.includes("-RESULTS/") ||
      p.includes("/PredicatesResults/")
    );
  };

  const push = (p) => {
    if (p && !seen.has(p)) {
      seen.add(p);
      ordered.push(p);
    }
  };

  if (tool === "DSE based Mutation Analyser" || tool === "Advance Code Coverage Profiler") {
    const byName = new Map();
    for (const p of paths) {
      if (p.includes("-RESULTS-") || p.includes("/Mutants/") || p.includes("/ReachedMutants/")) {
        continue;
      }
      if (tool === "Advance Code Coverage Profiler" && isAdvancedCoverageExcluded(p)) {
        continue;
      }
      if (isMutationArtifact(p)) continue;
      const name = path.basename(p);
      if (!byName.has(name)) {
        byName.set(name, p);
      }
    }

    const cleaned = Array.from(byName.values());
    if (tool === "DSE based Mutation Analyser") {
      return cleaned.slice(0, 5);
    }
    return cleaned;
  }

  if (tool === "Mutation Testing Profiler") {
    for (const p of paths) {
      if (p.includes("/SequenceGenerator/")) {
        push(p);
      }
    }
    if (ordered.length > 0) {
      return ordered;
    }
  }

  for (const p of paths) {
    push(p);
  }

  return ordered;
}

function listSamplesGeneric(language, tool, image, platform) {
  const args = [
    "run",
    "--platform",
    platform,
    "--rm",
    "--entrypoint",
    "python3",
    image,
    "/opt/trustinn/runner.py",
    "list-samples",
    "--language",
    language,
    "--tool",
    tool,
  ];

  return runProcess("docker", args).then((result) => ({ result, args }));
}

function applyLanguageSampleFilters(language, samples) {
  const pathSeen = new Set();
  const uniqueByPath = [];

  for (const item of samples) {
    if (!item?.path || pathSeen.has(item.path)) continue;
    pathSeen.add(item.path);
    uniqueByPath.push(item);
  }

  if (language !== "python") {
    return uniqueByPath;
  }

  const excluded = new Set(["python_assert.py", "asrt_chkr.py"]);
  return uniqueByPath.filter((item) => !excluded.has(path.basename(item.path).toLowerCase()));
}

function countSolidityFiles(folderPath, stopAfter = 11) {
  let count = 0;
  const queue = [folderPath];

  while (queue.length > 0) {
    const currentPath = queue.shift();
    if (!currentPath) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(currentPath, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith(".sol")) {
        count += 1;
        if (count >= stopAfter) {
          return count;
        }
      }
    }
  }

  return count;
}

// Setup auto-updater
function setupAutoUpdater() {
  if (isDev) {
    console.log("[UPDATE] Auto-updater disabled in development mode");
    return;
  }

  autoUpdater.checkForUpdatesAndNotify();

  autoUpdater.on("update-available", (info) => {
    console.log("[UPDATE] Update available:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("update:available", info);
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Update Available",
        message: `TrustINN ${info.version} is available.`,
        detail: "Click UPDATE to install the latest version.",
        buttons: ["Update", "Later"],
        defaultId: 0,
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[UPDATE] Update downloaded:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("update:downloaded");
      dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Update Ready",
        message: "TrustINN update is ready to install.",
        detail: "The application will restart to apply the update.",
        buttons: ["Install & Restart", "Later"],
        defaultId: 0,
      }).then((result) => {
        if (result.response === 0) {
          autoUpdater.quitAndInstall();
        }
      });
    }
  });

  autoUpdater.on("download-progress", (progress) => {
    if (mainWindow) {
      mainWindow.webContents.send("update:progress", progress);
    }
  });

  autoUpdater.on("error", (error) => {
    console.error("[UPDATE] Error:", error);
  });
}

// Initialize Docker setup on Windows
async function initializeDockerSetup() {
  if (!IS_WIN) return; // Only on Windows

  try {
    console.log("[SETUP] Initializing Docker setup...");
    const result = await setupDocker.initializeSetup();
    
    if (!result.success) {
      console.error("[SETUP] Docker setup failed:", result.error);
      dialog.showErrorBox("Setup Error", result.error || "Failed to initialize Docker");
      return false;
    }

    if (result?.config?.resultsDir) {
      configuredResultsDir = result.config.resultsDir;
      console.log("[SETUP] Using configured results directory:", configuredResultsDir);
    }

    console.log("[SETUP] Docker setup completed successfully");
    return true;
  } catch (error) {
    console.error("[SETUP] Error during Docker initialization:", error);
    return false;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  registerStaticAssetRewrite(mainWindow.webContents.session);

  if (isDev) {
    // Load static export files in development for better Electron compatibility
    const indexPath = resolveStaticRouteHtml("/");
    if (indexPath) {
      console.log("[DEV_MODE] Loading static HTML from:", indexPath);
      mainWindow.loadFile(indexPath);
    } else {
      console.warn("[DEV_MODE] Static HTML not found, falling back to localhost:3000");
      mainWindow.loadURL("http://localhost:3000"); // fallback
    }
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexPath = resolveStaticRouteHtml("/");

    if (!indexPath) {
      const candidatePaths = [
        path.join(app.getAppPath(), "out", "index.html"),
        path.join(process.resourcesPath, "app.asar", "out", "index.html"),
        path.join(process.resourcesPath, "out", "index.html"),
      ];
      const message = [
        "Unable to find Next.js static build output.",
        "Expected index.html in one of:",
        ...candidatePaths.map((p) => ` - ${p}`),
      ].join("\n");
      console.error("[MAIN]", message);
      dialog.showErrorBox("Startup Error", message);
      return mainWindow;
    }

    console.log("[MAIN] Loading index.html from:", indexPath);
    mainWindow.loadFile(indexPath);
  }

  return mainWindow;
}

app.whenReady().then(() => {
  ipcMain.handle("app:ping", async () => {
    return {
      message: "pong",
      platform: process.platform,
      date: new Date().toISOString(),
    };
  });

  ipcMain.handle("app:navigate", async (_, route) => {
    const normalizedRoute = normalizeAppRoute(route);

    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Main window is not available" };
    }

    try {
      if (isDev) {
        // Use static files in dev mode for better compatibility
        const routeHtmlPath = resolveStaticRouteHtml(normalizedRoute);
        if (routeHtmlPath) {
          await mainWindow.loadFile(routeHtmlPath);
        } else {
          return { ok: false, error: `Route not found: ${normalizedRoute}` };
        }
      } else {
        const routeHtmlPath = resolveStaticRouteHtml(normalizedRoute);
        if (!routeHtmlPath) {
          return { ok: false, error: `Route not found: ${normalizedRoute}` };
        }
        await mainWindow.loadFile(routeHtmlPath);
      }

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Navigation failed",
      };
    }
  });

  ipcMain.handle("tools:pick-file", async () => {
    const picked = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [
        { name: "Source Files", extensions: ["c", "h", "i", "java", "py", "sol", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });

    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    return { ok: true, path: picked.filePaths[0] };
  });

  ipcMain.handle("tools:pick-folder", async () => {
    const picked = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      title: "Select Solidity Project Folder",
      buttonLabel: "Use Folder",
    });

    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const folderPath = picked.filePaths[0];
    const solCount = countSolidityFiles(folderPath, 11);

    if (solCount === 0) {
      return { ok: false, error: "No .sol files found in selected folder." };
    }

    if (solCount > 10) {
      return { ok: false, error: "Maximum 10 .sol files allowed. Please choose a smaller project." };
    }

    return { ok: true, path: folderPath, solCount };
  });

  ipcMain.handle("tools:stop-run", async () => {
    console.log("[STOP] Stop requested - activeToolProcess exists:", !!activeToolProcess);
    
    if (!activeToolProcess) {
      console.log("[STOP] No active process to stop");
      return { ok: true, stopped: false, message: "No process running" };
    }

    const procToKill = activeToolProcess;
    const pid = procToKill.pid;
    activeToolProcess = null;

    const isAlive = (checkPid) => {
      try {
        process.kill(checkPid, 0);
        return true;
      } catch {
        return false;
      }
    };

    console.log(`[STOP] Attempting stop for PID ${pid}, detached=${procToKill.spawnargs ? true : false}`);
    const sendSignal = (signal) => {
      try {
        if (process.platform === "darwin" || process.platform === "linux") {
          process.kill(-pid, signal);
        }
      } catch (err) {
        console.warn(`[STOP] Group ${signal} failed for PID ${pid}:`, err.message);
      }

      try {
        procToKill.kill(signal);
      } catch (err) {
        console.warn(`[STOP] Proc ${signal} failed for PID ${pid}:`, err.message);
      }
    };

    // First try SIGINT like Ctrl+C.
    console.log(`[STOP] Sending SIGINT to process group PID ${pid}`);
    sendSignal("SIGINT");

    let stopped = false;
    for (let i = 0; i < 10; i += 1) {
      if (!isAlive(pid)) {
        stopped = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (!stopped) {
      console.log(`[STOP] SIGINT did not stop PID ${pid}, trying SIGTERM`);
      sendSignal("SIGTERM");
      for (let i = 0; i < 6; i += 1) {
        if (!isAlive(pid)) {
          stopped = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    if (!stopped) {
      console.log(`[STOP] SIGTERM did not stop PID ${pid}, forcing SIGKILL`);
      sendSignal("SIGKILL");
    }

    if (process.platform === "darwin" || process.platform === "linux") {
      try {
        require("child_process").execSync(`kill -9 -${pid} 2>/dev/null || true`, { stdio: "ignore", timeout: 1000 });
        console.log(`[STOP] Additional group kill executed for PID ${pid}`);
      } catch (err) {
        console.warn(`[STOP] Additional group kill failed for PID ${pid}:`, err.message);
      }
    }

    if (process.platform === "win32") {
      try {
        require("child_process").execSync(`taskkill /PID ${pid} /T /F 2>nul || true`, { stdio: "ignore", timeout: 1000, shell: true });
        console.log(`[STOP] Used taskkill for PID ${pid}`);
      } catch (err) {
        console.warn(`[STOP] Failed to taskkill:`, err.message);
      }
    }

    console.log(`[STOP] Stop handler completed for PID ${pid}, alive=${isAlive(pid)}`);
    return { ok: true, stopped: true, message: "Process terminated" };
  });

  ipcMain.handle("update:quit-and-install", async () => {
    if (!isDev) {
      autoUpdater.quitAndInstall();
    }
    return { ok: true };
  });

  ipcMain.handle("tools:read-file", async (_, filePath) => {
    try {
      if (!filePath || typeof filePath !== "string") {
        throw new Error("Invalid file path");
      }
      
      // If it's a Docker path (starts with /workspace), read from Docker
      if (filePath.startsWith("/workspace")) {
        const image = DEFAULT_IMAGE;
        const targetPath = filePath.replace(/"/g, '\\"');
        const args = [
          "run",
          "--platform", DEFAULT_PLATFORM,
          "--rm",
          "--entrypoint", "sh",
          image,
          "-c",
          `
TARGET="${targetPath}"
if [ -f "$TARGET" ]; then
  cat "$TARGET"
  exit 0
fi
NAME=$(basename "$TARGET")
for ROOT in /workspace /opt/trustinn /opt; do
  FOUND=$(find "$ROOT" -type f -name "$NAME" 2>/dev/null | head -n 1)
  if [ -n "$FOUND" ]; then
    cat "$FOUND"
    exit 0
  fi
done
echo "File not found inside docker image: $TARGET" >&2
exit 1
          `.trim(),
        ];
        
        try {
          const result = await runProcess("docker", args, { trackProcess: true });
          if (result.code === 0) {
            return result.stdout || "";
          } else {
            throw new Error(`Failed to read file from Docker: ${result.stderr}`);
          }
        } catch (dockerError) {
          throw new Error(`Docker read failed: ${dockerError instanceof Error ? dockerError.message : "Unknown error"}`);
        }
      }
      
      // Otherwise read from host filesystem
      const content = fs.readFileSync(filePath, "utf-8");
      return content;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Failed to read file");
    }
  });

  ipcMain.handle("tools:write-temp-file", async (_, { content, language }) => {
    try {
      if (!content || typeof content !== "string") {
        throw new Error("Invalid content");
      }
      if (!language || typeof language !== "string") {
        throw new Error("Invalid language");
      }

      const extension = {
        c: ".c",
        java: ".java",
        python: ".py",
        solidity: ".sol",
      }[language] || ".txt";

      const tempDir = path.join(os.tmpdir(), "trustinn-code");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFileName = `code_${Date.now()}${extension}`;
      const tempFilePath = path.join(tempDir, tempFileName);

      fs.writeFileSync(tempFilePath, content, "utf-8");
      // Set readable permissions for Docker
      fs.chmodSync(tempFilePath, 0o644);
      
      return tempFilePath;
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : "Failed to write temp file");
    }
  });

  ipcMain.handle("tools:delete-temp-file", async (_, filePath) => {
    try {
      if (!filePath || typeof filePath !== "string") {
        throw new Error("Invalid file path");
      }
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return true;
    } catch (error) {
      // Don't throw - file might already be deleted or not exist
      console.warn("Failed to delete temp file:", error instanceof Error ? error.message : "Unknown error");
      return false;
    }
  });

  ipcMain.handle("tools:list-samples", async (_, payload = {}) => {
    const tool = payload.tool || "";
    const language = payload.language || "c";
    const image = payload.image || DEFAULT_IMAGE;
    const platform = payload.platform || DEFAULT_PLATFORM;

    if (!tool) {
      return { ok: false, error: "Tool is required", samples: [], raw: "" };
    }

    try {
      const { result, args } = await listSamplesGeneric(language, tool, image, platform);
      const raw = (result.stdout || "").trim();

      if (result.code !== 0) {
        const errorMsg = result.stderr || "Failed to list samples";
        if (isDockerErrorMessage(errorMsg)) {
          showDockerErrorModal();
        }
        return {
          ok: false,
          error: errorMsg.trim(),
          samples: [],
          raw,
          command: `docker ${args.join(" ")}`,
        };
      }

      const parsed = raw ? JSON.parse(raw) : [];
      const normalized = Array.isArray(parsed)
        ? parsed
            .map((item) => {
              const samplePath = item?.path || "";
              return {
                name: item?.name || path.basename(samplePath),
                path: samplePath,
              };
            })
            .filter((item) => item.path)
        : [];

      let filtered = normalized;
      if (language === "c") {
        const candidatePaths = sampleCandidates(tool, normalized);
        const pathSet = new Set(candidatePaths);
        filtered = normalized.filter((item) => pathSet.has(item.path));
      }

      filtered = applyLanguageSampleFilters(language, filtered);

      return {
        ok: true,
        samples: filtered,
        raw,
        command: `docker ${args.join(" ")}`,
      };
    } catch (error) {
      const errorMsg = handleDockerError(error);
      return {
        ok: false,
        error: errorMsg,
        samples: [],
        raw: "",
      };
    }
  });

  ipcMain.handle("tools:list-c-samples", async (_, payload = {}) => {
    const tool = payload.tool || "";
    const image = payload.image || DEFAULT_IMAGE;
    const platform = payload.platform || DEFAULT_PLATFORM;

    if (!tool) {
      return { ok: false, error: "Tool is required", samples: [], raw: "" };
    }

    try {
      const { result, args } = await listSamplesGeneric("c", tool, image, platform);
      const raw = (result.stdout || "").trim();

      if (result.code !== 0) {
        const errorMsg = result.stderr || "Failed to list samples";
        if (isDockerErrorMessage(errorMsg)) {
          showDockerErrorModal();
        }
        return {
          ok: false,
          error: errorMsg.trim(),
          samples: [],
          raw,
          command: `docker ${args.join(" ")}`,
        };
      }

      const parsed = raw ? JSON.parse(raw) : [];
      const normalized = Array.isArray(parsed)
        ? parsed
            .map((item) => {
              const samplePath = item?.path || "";
              return {
                name: item?.name || path.basename(samplePath),
                path: samplePath,
              };
            })
            .filter((item) => item.path)
        : [];

      return {
        ok: true,
        samples: normalized,
        raw,
        command: `docker ${args.join(" ")}`,
      };
    } catch (error) {
      const errorMsg = handleDockerError(error);
      return {
        ok: false,
        error: errorMsg,
        samples: [],
        raw: "",
      };
    }
  });

  ipcMain.handle("tools:run-tool", async (_, payload = {}) => {
    const tool = payload.tool || "";
    const language = payload.language || "c";
    const image = payload.image || DEFAULT_IMAGE;
    const platform = payload.platform || DEFAULT_PLATFORM;
    const resultsDir = DEFAULT_RESULTS_DIR;
    const persistResults = payload.persistResults ?? PERSIST_RESULTS_DEFAULT;
    const sourceType = payload.sourceType || "sample";
    const samplePath = payload.samplePath || "";
    const filePath = payload.filePath || "";
    const folderPath = payload.folderPath || "";
    // Longer timeout for Advance Code Coverage Profiler (up to 1 hour)
    const timeoutSeconds = payload.timeoutSeconds || (tool === "Advance Code Coverage Profiler" ? 3600 : 1800);
    const params = paramsForLanguageTool(language, tool, payload.params);

    // Skip tool requirement for code execution
    if (sourceType !== "code" && !tool) {
      return { ok: false, error: "Tool is required", output: "", command: "" };
    }

    // ✅ CRITICAL: Check if Docker image exists before attempting to run tools
    console.log(`[MAIN] Checking if Docker image exists: ${image}`);
    try {
      const imageCheckResult = await runProcess("docker", ["images", "--filter", `reference=${image}`, "--format", "{{.ID}}"], { trackProcess: false });
      const imageExists = imageCheckResult.code === 0 && imageCheckResult.stdout && imageCheckResult.stdout.trim().length > 0;
      
      if (!imageExists) {
        console.log(`[MAIN] Docker image not found: ${image}. Pulling image...`);
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("setup:pull-progress", 5);
        }
        
        // Pull the image with retry logic
        const pullResult = await pullDockerImageWithRetry(image, 3);
        
        if (!pullResult.ok) {
          console.error(`[MAIN] Failed to pull Docker image: ${pullResult.error || "Unknown error"}`);
          return {
            ok: false,
            error: `Docker image unavailable: ${pullResult.error || "Failed to pull image"}. Please ensure you have internet connection and try again.`,
            output: "",
            command: ""
          };
        }
        
        console.log(`[MAIN] Docker image pulled successfully: ${image}`);
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("setup:pull-progress", 100);
        }
      } else {
        console.log(`[MAIN] Docker image found: ${image}`);
      }
    } catch (checkError) {
      console.error(`[MAIN] Error checking Docker image availability:`, checkError);
      return {
        ok: false,
        error: `Failed to verify Docker image: ${checkError instanceof Error ? checkError.message : "Unknown error"}`,
        output: "",
        command: ""
      };
    }

    fs.mkdirSync(resultsDir, { recursive: true });

    // Handle code execution/compilation
    if (sourceType === "code") {
      const codeContent = payload.codeContent || "";
      if (!codeContent.trim()) {
        return { ok: false, error: "No code provided", output: "", command: "" };
      }

      const tempDir = path.join(os.tmpdir(), "trustinn-code");
      fs.mkdirSync(tempDir, { recursive: true });
      
      // For Java, extract the public class name FIRST to use as filename
      let finalFileName = `code_${Date.now()}.${getFileExtension(language)}`;
      let finalClassName = "Program";
      
      if (language === "java") {
        const classMatch = codeContent.match(/public\s+class\s+(\w+)/);
        finalClassName = classMatch ? classMatch[1] : "Program";
        finalFileName = `${finalClassName}.java`;
      }
      
      const tempFilePath = path.join(tempDir, finalFileName);
      fs.writeFileSync(tempFilePath, codeContent);

      if (payload.compile) {
        // Execute the code
        let command = "";
        let args = [];
        let compileCommand = "";
        let compileArgs = [];
        const useDocker = IS_WIN;
        const containerFilePath = `/workspace/${finalFileName}`;

        try {
          if (language === "java") {
            if (useDocker) {
              compileCommand = "docker";
              compileArgs = buildDockerRunArgs(tempDir, ["run-tool", containerFilePath]);
            } else {
              compileCommand = "javac";
              compileArgs = [tempFilePath];
            }

            const compileResult = await runProcess(compileCommand, compileArgs, {
              trackProcess: true,
              commandTimeout: 30000,
              onData: (stream, data) => {
                if (mainWindow) {
                  mainWindow.webContents.send('code-output-live', { language, stream, data });
                }
              }
            });

            if (compileResult.code !== 0) {
              fs.unlinkSync(tempFilePath);
              return { ok: false, output: compileResult.stderr, error: "Compilation failed", command: `${compileCommand} ${compileArgs.join(" ")}`, trialDeducted: false };
            }

            if (useDocker) {
              command = "docker";
              args = buildDockerRunArgs(tempDir, ["run-tool", containerFilePath]);
            } else {
              command = "java";
              args = ["-cp", tempDir, finalClassName];
            }
          } else if (language === "python") {
            if (useDocker) {
              command = "docker";
              args = buildDockerRunArgs(tempDir, ["run-tool", containerFilePath]);
            } else {
              command = "python3";
              args = [tempFilePath];
            }
          } else if (language === "c") {
            const exePath = tempFilePath.replace(/\.c$/, "");
            if (useDocker) {
              compileCommand = "docker";
              compileArgs = buildDockerRunArgs(tempDir, ["run-tool", containerFilePath]);
            } else {
              compileCommand = "gcc";
              compileArgs = [tempFilePath, "-o", exePath];
            }

            const compileResult = await runProcess(compileCommand, compileArgs, {
              trackProcess: true,
              commandTimeout: 30000,
              onData: (stream, data) => {
                if (mainWindow) {
                  mainWindow.webContents.send('code-output-live', { language, stream, data });
                }
              }
            });

            if (compileResult.code !== 0) {
              fs.unlinkSync(tempFilePath);
              return { ok: false, output: compileResult.stderr, error: "Compilation failed", command: `${compileCommand} ${compileArgs.join(" ")}`, trialDeducted: false };
            }

            if (useDocker) {
              command = "docker";
              args = buildDockerRunArgs(tempDir, ["run-tool", containerFilePath]);
            } else {
              command = exePath;
              args = [];
            }
          } else if (language === "solidity") {
            const sourceCode = fs.readFileSync(tempFilePath, "utf-8");
            fs.unlinkSync(tempFilePath);

            if (!sourceCode.includes("pragma solidity")) {
              return { ok: false, output: "", error: "Missing pragma solidity declaration", trialDeducted: false };
            }
            if (!sourceCode.includes("contract ")) {
              return { ok: false, output: "", error: "Missing contract declaration", trialDeducted: false };
            }
            const contractName = sourceCode.match(/contract\s+([A-Za-z_]\w*)/)?.[1];
            if (!contractName) {
              return { ok: false, output: "", error: "Could not extract contract name", trialDeducted: false };
            }

            return {
              ok: true,
              output: `✅ Solidity syntax validated\nContract: ${contractName}\n\nNote: For full compilation, use Hardhat or Truffle`,
              error: "",
              command: "solidity-syntax-check",
              trialDeducted: false,
            };
          } else {
            fs.unlinkSync(tempFilePath);
            return { ok: false, error: "Code execution not supported for this language", output: "", trialDeducted: false };
          }

          const result = await runProcess(command, args, { 
            trackProcess: true, // Track so Stop button can kill it
            commandTimeout: 30000, // 30 second timeout to prevent infinite loops
            onData: (stream, data) => {
              if (mainWindow) {
                mainWindow.webContents.send('code-output-live', { language, stream, data });
              }
            }
          });
          
          // Cleanup
          fs.unlinkSync(tempFilePath);
          if (language === "java") {
            const classFile = path.join(tempDir, `${finalClassName}.class`);
            if (fs.existsSync(classFile)) fs.unlinkSync(classFile);
          } else if (language === "c") {
            const exePath = tempFilePath.replace(/\.c$/, "");
            if (fs.existsSync(exePath)) fs.unlinkSync(exePath);
          }

          // Execution always deducts trial (success or failure)
          return { ok: result.code === 0, output: "", error: result.stderr, command: `${command} ${args.join(" ")}`, trialDeducted: true };
        } catch (error) {
          // Cleanup on error
          if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
          const errorMessage = error instanceof Error ? error.message : String(error);
          if (errorMessage.includes("ENOENT") || errorMessage.includes("not found") || errorMessage.includes("command not found")) {
            const missingTool = useDocker ? "docker" : language === "python" ? "python3" : language === "java" ? "javac/java" : language === "c" ? "gcc" : "required tool";
            return {
              ok: false,
              error: `Required tool not found: ${missingTool}. Install Docker Desktop or the ${missingTool} toolchain and retry.`,
              output: "",
              trialDeducted: false,
            };
          }

          return { ok: false, error: errorMessage || "Execution failed", output: "", trialDeducted: true };
        }
      } else {
        // Run analysis tool on the temp file
        filePath = tempFilePath;
        sourceType = "file";
        // Continue to file handling below
      }
    }

    let sampleArg = samplePath;
    const args = [
      "run",
      "--platform",
      platform,
      "--rm",
      "-m", "4g",  // Allow up to 4GB memory
    ];

    // Always persist results to host so users can download analysis files
    // Results are mounted to ~/Downloads/TrustinnDownloads
    args.push("-v", `${getDockerVolumePath(resultsDir)}:/results`);

    if (sourceType === "file") {
      if (!filePath) {
        return { ok: false, error: "File path is required", output: "", command: "" };
      }

      const inputDir = path.dirname(filePath);
      const inputName = path.basename(filePath);
      // Mount temp files to /input and pass full path
      args.push("-v", `${getDockerVolumePath(inputDir)}:/input:ro`);
      sampleArg = `/input/${inputName}`;
    } else if (sourceType === "folder") {
      console.log("[MAIN] Folder mode - folderPath:", folderPath, "trimmed:", folderPath?.trim());
      const dockerPath = getDockerVolumePath(folderPath);
      console.log("[MAIN] Docker volume path:", dockerPath);
      console.log("[MAIN] Docker mount command: -v", `${dockerPath}:/input/project:ro`);
      if (!folderPath || !folderPath.trim()) {
        return { ok: false, error: "Folder path is required", output: "", command: "" };
      }

      args.push("-v", `${dockerPath}:/input/project:ro`);
      
      // For Solidity folders, analyze all .sol files
      if (language === "solidity") {
        console.log("[MAIN] Solidity folder mode - will analyze all .sol files in folder");
        // Don't set sampleArg here, will handle in execution
      } else {
        sampleArg = "/input/project";
      }
    }

    // Add entrypoint and image
    args.push("--entrypoint", "python3", image, "/opt/trustinn/runner.py", "run-tool");

    // For Solidity folders, run VeriSol directly on the entire folder for proper project analysis
    // This allows VeriSol to see all contracts together and generate proper coverage metrics
    if (language === "solidity" && sourceType === "folder") {
      try {
        const fs = require("fs");
        const solFiles = fs.readdirSync(folderPath).filter(file => file.endsWith('.sol'));
        if (solFiles.length === 0) {
          return { ok: false, error: "No .sol files found in folder", output: "", command: "" };
        }

        console.log(`[MAIN] Found ${solFiles.length} Solidity files:`, solFiles);

        // Determine VeriSol mode from params (default: bmc)
        let verisolMode = "bmc";
        try {
          const parsedParams = JSON.parse(params);
          if (parsedParams.solidityMode) {
            verisolMode = parsedParams.solidityMode;
          }
        } catch {
          // Params not JSON, use default
        }

        // Call VeriSol directly on the entire folder
        // VeriSol needs access to tools in /workspace/SOLIDITY, so mount user folder as a subdirectory
        const dockerArgs = [
          "run",
          "--platform", platform,
          "--rm",
          "-m", "4g"
        ];

        // Always persist results for Solidity so users can download them
        // Create the directory if it doesn't exist
        fs.mkdirSync(resultsDir, { recursive: true });
        dockerArgs.push("-v", `${getDockerVolumePath(resultsDir)}:/results`);

        // Mount user's folder inside /workspace/SOLIDITY so VeriSol can find its tools (.assertinserter)
        // This ensures VeriSol has everything it needs in the same directory tree
        dockerArgs.push("-v", `${getDockerVolumePath(folderPath)}:/workspace/SOLIDITY/UserProject:ro`);

        // Call VeriSol directly with bash
        // IMPORTANT: Run from /workspace/SOLIDITY so VeriSol can find .assertinserter and other tools
        // VeriSol creates Results folder, copy to /results which is mounted to host
        dockerArgs.push(
          "--entrypoint", "bash",
          image,
          "-c",
          `cd /workspace/SOLIDITY && java -jar ./latest-java.jar ./UserProject ${verisolMode}; if [ -d ./Results ]; then cp -r ./Results/* /results/; fi`
        );

        const dockerCommand = `docker ${dockerArgs.join(" ")}`;
        console.log(`[MAIN] Running VeriSol directly on folder with mode: ${verisolMode}`);
        console.log(`[MAIN] Docker command: ${dockerCommand}`);

        const result = await runProcess("docker", dockerArgs, { trackProcess: true, commandTimeout: timeoutSeconds * 1000 });
        
        const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

        return {
          ok: result.code === 0,
          output: output,
          exitCode: result.code || 1,
          command: dockerCommand,
          resultsDir,
        };

      } catch (error) {
        console.error("[MAIN] Error processing Solidity folder:", error);
        return { ok: false, error: "Unable to process Solidity files from folder", output: "", command: "" };
      }
    }

    if (!sampleArg) {
      return { ok: false, error: "Sample path is required", output: "", command: "" };
    }

    // Add run-tool arguments for non-Solidity folder case
    args.push(
      "--language",
      language,
      "--tool",
      tool,
      "--sample",
      sampleArg,
      "--params",
      params
    );

    const command = `docker ${args.join(" ")}`;
    console.log("[MAIN] Executing Docker command:", command);

    try {
      // Log for debugging
      if (tool === "Advance Code Coverage Profiler") {
        console.log(`[ACCP DEBUG] Running: ${tool}`);
        console.log(`[ACCP DEBUG] Params: ${params}`);
        console.log(`[ACCP DEBUG] Sample: ${sampleArg}`);
      }
      
      // For Advance Code Coverage Profiler, don't impose timeout - let it complete
      let result;
      
      if (tool === "Advance Code Coverage Profiler") {
        // Run without Promise.race to avoid premature timeout
        result = await runProcess("docker", args, { trackProcess: true });
        console.log(`[ACCP DEBUG] Exit code: ${result.code}, stdout length: ${result.stdout.length}, stderr length: ${result.stderr.length}`);
      } else {
        // For other tools, use configurable timeout
        const timeoutMs = Math.max(timeoutSeconds, 60) * 1000; // Minimum 60 seconds
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Tool execution timeout (${timeoutSeconds}s)`)), timeoutMs)
        );
        
        const resultPromise = runProcess("docker", args, { trackProcess: true });
        try {
          result = await Promise.race([resultPromise, timeoutPromise]);
        } catch (timeoutErr) {
          return {
            ok: false,
            output: "",
            error: timeoutErr instanceof Error ? timeoutErr.message : "Timeout",
            command,
            resultsDir,
          };
        }
      }
      
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

      if (result.code !== 0 && isDockerErrorMessage(output)) {
        showDockerErrorModal();
      }

      return {
        ok: result.code === 0,
        output,
        exitCode: result.code,
        command,
        resultsDir,
      };
    } catch (error) {
      const errorMsg = handleDockerError(error);
      return {
        ok: false,
        error: errorMsg,
        output: "",
        command,
      };
    }
  });

  ipcMain.handle("tools:run-c-tool", async (_, payload = {}) => {
    const tool = payload.tool || "";
    const image = payload.image || DEFAULT_IMAGE;
    const platform = payload.platform || DEFAULT_PLATFORM;
    const resultsDir = DEFAULT_RESULTS_DIR;
    const persistResults = payload.persistResults ?? PERSIST_RESULTS_DEFAULT;
    const sourceType = payload.sourceType || "sample";
    const samplePath = payload.samplePath || "";
    const filePath = payload.filePath || "";
    // Longer timeout for Advance Code Coverage Profiler (up to 1 hour)
    const timeoutSeconds = payload.timeoutSeconds || (tool === "Advance Code Coverage Profiler" ? 3600 : 1800);
    const params = paramsForLanguageTool("c", tool, payload.params);

    if (!tool) {
      return { ok: false, error: "Tool is required", output: "", command: "" };
    }

    // ✅ CRITICAL: Check if Docker image exists before attempting to run tools
    console.log(`[MAIN] Checking if Docker image exists: ${image}`);
    try {
      const imageCheckResult = await runProcess("docker", ["images", "--filter", `reference=${image}`, "--format", "{{.ID}}"], { trackProcess: false });
      const imageExists = imageCheckResult.code === 0 && imageCheckResult.stdout && imageCheckResult.stdout.trim().length > 0;
      
      if (!imageExists) {
        console.log(`[MAIN] Docker image not found: ${image}. Pulling image...`);
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("setup:pull-progress", 5);
        }
        
        // Pull the image with retry logic
        const pullResult = await pullDockerImageWithRetry(image, 3);
        
        if (!pullResult.ok) {
          console.error(`[MAIN] Failed to pull Docker image: ${pullResult.error || "Unknown error"}`);
          return {
            ok: false,
            error: `Docker image unavailable: ${pullResult.error || "Failed to pull image"}. Please ensure you have internet connection and try again.`,
            output: "",
            command: ""
          };
        }
        
        console.log(`[MAIN] Docker image pulled successfully: ${image}`);
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send("setup:pull-progress", 100);
        }
      } else {
        console.log(`[MAIN] Docker image found: ${image}`);
      }
    } catch (checkError) {
      console.error(`[MAIN] Error checking Docker image availability:`, checkError);
      return {
        ok: false,
        error: `Failed to verify Docker image: ${checkError instanceof Error ? checkError.message : "Unknown error"}`,
        output: "",
        command: ""
      };
    }

    fs.mkdirSync(resultsDir, { recursive: true });

    let sampleArg = samplePath;
    const args = [
      "run",
      "--platform",
      platform,
      "--rm",
      "-m", "4g",  // Allow up to 4GB memory
    ];

    // Always persist results to host so users can download analysis files
    // Results are mounted to ~/Downloads/TrustinnDownloads
    args.push("-v", `${getDockerVolumePath(resultsDir)}:/results`);

    if (sourceType === "file") {
      if (!filePath) {
        return { ok: false, error: "File path is required", output: "", command: "" };
      }

      const inputDir = path.dirname(filePath);
      const inputName = path.basename(filePath);
      // Mount temp files to /input and pass full path
      args.push("-v", `${getDockerVolumePath(inputDir)}:/input:ro`);
      sampleArg = `/input/${inputName}`;
    }

    if (!sampleArg) {
      return { ok: false, error: "Sample path is required", output: "", command: "" };
    }

    // Add entrypoint and image
    args.push("--entrypoint", "python3", image, "/opt/trustinn/runner.py", "run-tool");

    // Add run-tool arguments for C
    args.push(
      "--language",
      "c",
      "--tool",
      tool,
      "--sample",
      sampleArg,
      "--params",
      params
    );

    const command = `docker ${args.join(" ")}`;

    try {
      // Log the command for debugging
      if (tool === "Advance Code Coverage Profiler") {
        console.log(`[ACCP DEBUG] Running: ${tool}`);
        console.log(`[ACCP DEBUG] Params: ${params}`);
        console.log(`[ACCP DEBUG] Sample: ${sampleArg}`);
      }
      
      // For Advance Code Coverage Profiler, don't impose timeout - let it complete
      let result;
      
      if (tool === "Advance Code Coverage Profiler") {
        // Run without Promise.race to avoid premature timeout
        result = await runProcess("docker", args, { trackProcess: true });
        console.log(`[ACCP DEBUG] Exit code: ${result.code}, stdout length: ${result.stdout.length}, stderr length: ${result.stderr.length}`);
      } else {
        // For other tools, use configurable timeout
        const timeoutMs = Math.max(timeoutSeconds, 60) * 1000; // Minimum 60 seconds
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`Tool execution timeout (${timeoutSeconds}s)`)), timeoutMs)
        );
        
        const resultPromise = runProcess("docker", args, { trackProcess: true });
        try {
          result = await Promise.race([resultPromise, timeoutPromise]);
        } catch (timeoutErr) {
          return {
            ok: false,
            output: "",
            error: timeoutErr instanceof Error ? timeoutErr.message : "Timeout",
            command,
            resultsDir,
          };
        }
      }
      
      const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

      if (result.code !== 0 && isDockerErrorMessage(output)) {
        showDockerErrorModal();
      }

      return {
        ok: result.code === 0,
        output,
        exitCode: result.code,
        command,
        resultsDir,
      };
    } catch (error) {
      const errorMsg = handleDockerError(error);
      return {
        ok: false,
        error: errorMsg,
        output: "",
        command,
        resultsDir,
      };
    }
  });

  ipcMain.handle("docker:check-status", async () => {
    try {
      const result = await runProcess("docker", ["ps"], { trackProcess: false });
      
      if (result.code === 0) {
        console.log('[IPC] Docker is running');
        return { ok: true, isRunning: true, message: "Docker daemon is running" };
      } else {
        const errorMsg = result.stderr || result.stdout || "Unknown error";
        console.warn(`[IPC] Docker not running: ${errorMsg}`);
        return { ok: false, isRunning: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to check Docker status";
      console.error(`[IPC] Error checking Docker status: ${errorMsg}`);
      return { ok: false, isRunning: false, error: errorMsg };
    }
  });

  ipcMain.handle("tools:remove-docker-image", async (_, imageName) => {
    try {
      if (!imageName || typeof imageName !== "string") {
        return { ok: false, error: "Invalid image name" };
      }

      console.log(`[IPC] Removing Docker image: ${imageName}`);

      const result = await runProcess("docker", ["rmi", "-f", imageName], { trackProcess: false });

      if (result.code === 0) {
        console.log(`[IPC] Successfully removed Docker image: ${imageName}`);
        return { ok: true, message: `Docker image '${imageName}' removed successfully` };
      } else {
        const errorMsg = result.stderr || result.stdout || "Unknown error";
        console.error(`[IPC] Failed to remove Docker image: ${errorMsg}`);
        return { ok: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to remove Docker image";
      console.error(`[IPC] Error removing Docker image: ${errorMsg}`);
      return { ok: false, error: errorMsg };
    }
  });

  ipcMain.handle("docker:check-image-exists", async (_, imageName) => {
    try {
      if (!imageName || typeof imageName !== "string") {
        return { ok: false, exists: false, error: "Invalid image name" };
      }

      console.log(`[IPC] Checking if Docker image exists: ${imageName}`);

      const result = await runProcess("docker", ["images", "--filter", `reference=${imageName}`, "--format", "{{.ID}}"], { trackProcess: false });

      if (result.code === 0) {
        const imageId = result.stdout.trim();
        const exists = imageId.length > 0;
        console.log(`[IPC] Docker image exists: ${exists} (ID: ${imageId || 'none'})`);
        return { ok: true, exists };
      } else {
        const errorMsg = result.stderr || result.stdout || "Failed to check image";
        console.error(`[IPC] Failed to check Docker image: ${errorMsg}`);
        return { ok: false, exists: false, error: errorMsg };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to check Docker image";
      console.error(`[IPC] Error checking Docker image: ${errorMsg}`);
      return { ok: false, exists: false, error: errorMsg };
    }
  });

  // Helper function to pull Docker image with retry logic
  function pullDockerImageWithRetry(imageName, maxRetries = 3) {
    return new Promise((resolve) => {
      let attempt = 0;
      isDockerPullCancelled = false;

      const attemptPull = () => {
        if (isDockerPullCancelled) {
          return resolve({ ok: false, cancelled: true, error: "Docker pull cancelled by user" });
        }

        attempt++;
        console.log(`[IPC] Attempt ${attempt}/${maxRetries} to pull Docker image: ${imageName}`);

        try {
          const isDeveloping = isDev;
          const isAppleSilicon = process.arch === "arm64" && process.platform === "darwin";
          
          let pullArgs = ["pull", imageName];
          if (isAppleSilicon && isDeveloping) {
            console.log(`[IPC] Apple Silicon detected - pulling with platform override to linux/amd64`);
            pullArgs = ["pull", "--platform", "linux/amd64", imageName];
          }

          const proc = spawn("docker", pullArgs, {
            stdio: ["ignore", "pipe", "pipe"],
          });
          activeDockerPullProcess = proc;

          let output = "";
          const seen = new Set();

          const parseLine = (line) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            output += `${trimmed}\n`;
            if (trimmed.includes("Downloading") || trimmed.includes("Extracting") || trimmed.includes("Pull complete")) {
              seen.add(trimmed.split(":")[0]);
            }

            const approxProgress = Math.min(95, Math.max(10, seen.size * 4));
            console.log(`[IPC] Docker pull progress: ${approxProgress}%`);
            
            // Send progress to renderer
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send("setup:pull-progress", approxProgress);
            }
          };

          proc.stdout.on("data", (chunk) => {
            String(chunk).split(/\r?\n/).forEach(parseLine);
          });

          proc.stderr.on("data", (chunk) => {
            String(chunk).split(/\r?\n/).forEach(parseLine);
          });

          proc.on("close", (code) => {
            activeDockerPullProcess = null;

            if (isDockerPullCancelled) {
              console.log("[IPC] Docker pull cancelled by user");
              return resolve({ ok: false, cancelled: true, error: "Docker pull cancelled by user" });
            }

            if (code === 0) {
              console.log(`[IPC] Successfully pulled Docker image on attempt ${attempt}`);
              
              // Send final progress
              if (mainWindow && mainWindow.webContents) {
                mainWindow.webContents.send("setup:pull-progress", 100);
              }
              
              return resolve({ ok: true, message: `Docker image pulled successfully` });
            } else {
              const errorMsg = output.trim() || "Failed to pull image";
              console.error(`[IPC] Attempt ${attempt} failed: ${errorMsg}`);

              // Retry if attempts remaining
              if (attempt < maxRetries) {
                console.log(`[IPC] Retrying in 2 seconds...`);
                setTimeout(attemptPull, 2000);
              } else {
                console.error(`[IPC] All ${maxRetries} attempts failed`);
                return resolve({ ok: false, error: `Failed after ${maxRetries} attempts: ${errorMsg}` });
              }
            }
          });

          proc.on("error", (error) => {
            activeDockerPullProcess = null;

            if (isDockerPullCancelled) {
              return resolve({ ok: false, cancelled: true, error: "Docker pull cancelled by user" });
            }

            const errorMsg = error instanceof Error ? error.message : "Failed to pull Docker image";
            console.error(`[IPC] Process error on attempt ${attempt}: ${errorMsg}`);

            // Retry if attempts remaining
            if (attempt < maxRetries) {
              console.log(`[IPC] Retrying in 2 seconds...`);
              setTimeout(attemptPull, 2000);
            } else {
              return resolve({ ok: false, error: `Failed after ${maxRetries} attempts: ${errorMsg}` });
            }
          });
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : "Unexpected error";
          console.error(`[IPC] Exception on attempt ${attempt}: ${errorMsg}`);

          // Retry if attempts remaining
          if (attempt < maxRetries) {
            console.log(`[IPC] Retrying in 2 seconds...`);
            setTimeout(attemptPull, 2000);
          } else {
            return resolve({ ok: false, error: `Failed after ${maxRetries} attempts: ${errorMsg}` });
          }
        }
      };

      attemptPull();
    });
  }

  ipcMain.handle("docker:pull-image", async (_, imageName) => {
    try {
      if (!imageName || typeof imageName !== "string") {
        return { ok: false, error: "Invalid image name" };
      }

      console.log(`[IPC] Pulling Docker image with retry logic: ${imageName}`);
      return await pullDockerImageWithRetry(imageName, 3);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to pull Docker image";
      console.error(`[IPC] Unexpected error: ${errorMsg}`);
      return { ok: false, error: errorMsg };
    }
  });

  ipcMain.handle("docker:stop-pull-image", async () => {
    try {
      isDockerPullCancelled = true;

      if (activeDockerPullProcess && !activeDockerPullProcess.killed) {
        activeDockerPullProcess.kill("SIGTERM");
        console.log("[IPC] Docker pull process stopped by user");
      }

      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send("setup:status", { message: "Setup cancelled by user", progress: 0 });
      }

      return { ok: true, stopped: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Failed to stop Docker pull";
      console.error(`[IPC] Error stopping Docker pull: ${errorMsg}`);
      return { ok: false, stopped: false, error: errorMsg };
    }
  });

  // Setup auto-updater
  setupAutoUpdater();

  // Create main window
  createMainWindow();

  // Initialize Docker setup on Windows (async, will complete in background)
  if (IS_WIN && !isDev) {
    initializeDockerSetup().catch((error) => {
      console.error("[SETUP] Unhandled error during Docker setup:", error);
    });
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
