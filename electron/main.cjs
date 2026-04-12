/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { autoUpdater } = require("electron-updater");
const setupDocker = require("./setup-docker.cjs");

const isDev = !app.isPackaged;
const devUrl = process.env.ELECTRON_RENDERER_URL || "http://localhost:3000";
const DEFAULT_IMAGE = process.env.TRUSTINN_IMAGE || "rajeshbyreddy95/trustinn-tools:4.1.2";
const DEFAULT_PLATFORM = process.env.TRUSTINN_PLATFORM || "linux/amd64";
const DEFAULT_RESULTS_DIR = process.env.TRUSTINN_RESULTS_DIR || path.join(os.homedir(), "Downloads", "TrustinnDownloads");
const IS_MAC = process.platform === "darwin";
const IS_WIN = process.platform === "win32";
let activeToolProcess = null;
let mainWindow = null;

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

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
      timeout: commandTimeout, // Process timeout if specified
    });

    if (trackProcess) {
      activeToolProcess = proc;
    }

    let stdout = "";
    let stderr = "";
    let stdoutChunks = 0;
    let stderrChunks = 0;
    let hasData = false;

    proc.stdout.on("data", (chunk) => {
      hasData = true;
      stdoutChunks++;
      stdout += String(chunk);
      // Log first chunk for ACCP
      if (stdoutChunks === 1 && stdout.includes("NITMiner Technologies")) {
        console.log(`[DEBUG] First stdout chunk received for ACCP tool`);
      }
    });

    proc.stderr.on("data", (chunk) => {
      hasData = true;
      stderrChunks++;
      stderr += String(chunk);
    });

    proc.on("exit", (code, signal) => {
      console.log(`[DEBUG] Process exited - code: ${code}, signal: ${signal}`);
    });

    proc.on("error", (error) => {
      console.error("[DEBUG] Process error:", error.message);
      reject(error);
    });

    proc.on("close", (code) => {
      if (trackProcess && activeToolProcess === proc) {
        activeToolProcess = null;
      }
      // Log for debugging ACCP issues
      if (stdout.includes("NITMiner Technologies")) {
        console.log(`[DEBUG] Process closed - code: ${code}, hasData: ${hasData}, stdout chunks: ${stdoutChunks}, length: ${stdout.length}, stderr chunks: ${stderrChunks}, length: ${stderr.length}`);
        const firstLine = stdout.split("\n")[0];
        const lastLine = stdout.split("\n").pop();
        console.log(`[DEBUG] First output line: ${firstLine?.substring(0, 100)}`);
        console.log(`[DEBUG] Last output line: ${lastLine?.substring(0, 100)}`);
        if (stderr) console.log(`[DEBUG] stderr: ${stderr.substring(0, 500)}`);
      }
      resolve({ code: code ?? 1, stdout, stderr });
    });

    // Set a very long process timeout only if specified (for safety)
    if (commandTimeout > 0) {
      setTimeout(() => {
        if (proc && !proc.killed) {
          console.log(`[DEBUG] Process timeout after ${commandTimeout}ms, killing process`);
          proc.kill();
        }
      }, commandTimeout + 5000);
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
    
    dialog.showErrorDialog(mainWindow, title, message);
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
      dialog.showErrorDialog("Setup Error", result.error || "Failed to initialize Docker");
      return false;
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

  if (isDev) {
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const candidatePaths = [
      path.join(app.getAppPath(), "out", "index.html"),
      path.join(process.resourcesPath, "app.asar", "out", "index.html"),
      path.join(process.resourcesPath, "out", "index.html"),
    ];

    const indexPath = candidatePaths.find((candidate) => fs.existsSync(candidate));

    if (!indexPath) {
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

  ipcMain.handle("tools:pick-file", async () => {
    const picked = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Source Files", extensions: ["c", "h", "i", "txt", "*"] }],
    });

    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    return { ok: true, path: picked.filePaths[0] };
  });

  ipcMain.handle("tools:stop-run", async () => {
    if (!activeToolProcess) {
      return { ok: true, stopped: false };
    }

    try {
      activeToolProcess.kill("SIGTERM");

      setTimeout(() => {
        if (activeToolProcess) {
          activeToolProcess.kill("SIGKILL");
        }
      }, 1200);

      return { ok: true, stopped: true };
    } catch (error) {
      return {
        ok: false,
        stopped: false,
        error: error instanceof Error ? error.message : "Failed to stop execution",
      };
    }
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
        const image = "rajeshbyreddy95/trustinn-tools:3.1.4";
        const args = [
          "run",
          "--platform", "linux/amd64",
          "--rm",
          "-v", "/tmp/trustinn-code:/workspace/temp-input:ro",
          "--entrypoint", "sh",
          image,
          "-c",
          `cat "${filePath}"`
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
    const resultsDir = payload.resultsDir || DEFAULT_RESULTS_DIR;
    const sourceType = payload.sourceType || "sample";
    const samplePath = payload.samplePath || "";
    const filePath = payload.filePath || "";
    // Longer timeout for Advance Code Coverage Profiler (up to 1 hour)
    const timeoutSeconds = payload.timeoutSeconds || (tool === "Advance Code Coverage Profiler" ? 3600 : 1800);
    const params = paramsForLanguageTool(language, tool, payload.params);

    if (!tool) {
      return { ok: false, error: "Tool is required", output: "", command: "" };
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

    // Add volume mounts
    // Mount results directory only (samples come from Docker image)
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

    // Add entrypoint and image
    args.push("--entrypoint", "python3", image, "/opt/trustinn/runner.py", "run-tool");

    if (!sampleArg) {
      return { ok: false, error: "Sample path is required", output: "", command: "" };
    }

    // Add run-tool arguments
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
    const resultsDir = payload.resultsDir || DEFAULT_RESULTS_DIR;
    const sourceType = payload.sourceType || "sample";
    const samplePath = payload.samplePath || "";
    const filePath = payload.filePath || "";
    // Longer timeout for Advance Code Coverage Profiler (up to 1 hour)
    const timeoutSeconds = payload.timeoutSeconds || (tool === "Advance Code Coverage Profiler" ? 3600 : 1800);
    const params = paramsForLanguageTool("c", tool, payload.params);

    if (!tool) {
      return { ok: false, error: "Tool is required", output: "", command: "" };
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

    // Add volume mounts
    // Mount results directory only (samples come from Docker image)
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
