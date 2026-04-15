/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { dialog, BrowserWindow, shell } = require("electron");

const CONFIG_DIR = path.join(os.homedir(), "AppData", "Roaming", "TrustINN");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.ini");
const DOCKER_IMAGE = "rajeshbyreddy95/trustinn-tools:latest";
const DEFAULT_RESULTS_DIR = path.join(os.homedir(), "Downloads", "TrustinnDownloads");

function getMainWindow() {
  return BrowserWindow.getAllWindows()[0] || null;
}

function emitSetupEvent(channel, payload) {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function setSetupStatus(message, progress) {
  emitSetupEvent("setup:status", { message, progress });
}

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function parseConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { resultsDir: DEFAULT_RESULTS_DIR };
    }

    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    const config = {};

    for (const line of content.split("\n")) {
      const [key, ...rest] = line.split("=");
      if (!key || rest.length === 0) continue;
      config[key.trim()] = rest.join("=").trim();
    }

    if (!config.resultsDir) {
      config.resultsDir = DEFAULT_RESULTS_DIR;
    }

    return config;
  } catch (error) {
    console.error("[SETUP] Error parsing config:", error);
    return { resultsDir: DEFAULT_RESULTS_DIR };
  }
}

function writeConfig(config) {
  ensureConfigDir();
  const lines = Object.entries(config).map(([key, value]) => `${key}=${value}`);
  fs.writeFileSync(CONFIG_FILE, `${lines.join("\n")}\n`, "utf-8");
}

function isDockerInstalled() {
  try {
    execSync("docker --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function isDockerRunning() {
  try {
    execSync("docker ps", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function isDockerImagePresentLocally() {
  try {
    execSync(`docker image inspect ${DOCKER_IMAGE}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

function showErrorDialog(title, message) {
  const mainWindow = getMainWindow();
  if (mainWindow) {
    dialog.showErrorBox(title, message);
  }
}

function promptDockerInstall() {
  const mainWindow = getMainWindow();
  if (!mainWindow) return false;

  const result = dialog.showMessageBoxSync(mainWindow, {
    type: "warning",
    title: "Docker Not Installed",
    message: "Docker Desktop is required to run TrustINN.",
    detail: "Install Docker Desktop, then restart TrustINN.",
    buttons: ["Download Docker", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });

  if (result === 0) {
    shell.openExternal("https://www.docker.com/products/docker-desktop");
  }

  return result === 0;
}

function getDockerDesktopCandidatePaths() {
  const candidates = [];
  if (process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, "Docker", "Docker", "Docker Desktop.exe"));
  }
  if (process.env["ProgramFiles(x86)"]) {
    candidates.push(path.join(process.env["ProgramFiles(x86)"], "Docker", "Docker", "Docker Desktop.exe"));
  }
  if (process.env.LocalAppData) {
    candidates.push(path.join(process.env.LocalAppData, "Programs", "Docker", "Docker", "Docker Desktop.exe"));
  }
  return candidates;
}

function startDockerDesktopWithCmd() {
  const dockerPath = getDockerDesktopCandidatePaths().find((candidate) => fs.existsSync(candidate));
  if (!dockerPath) {
    throw new Error("Docker Desktop executable was not found.");
  }

  const args = ["/c", "start", "", dockerPath];
  const proc = spawn("cmd.exe", args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  proc.unref();
}

function promptStartDocker() {
  const mainWindow = getMainWindow();
  if (!mainWindow) return false;

  const result = dialog.showMessageBoxSync(mainWindow, {
    type: "warning",
    title: "Docker Not Running",
    message: "Docker Desktop is not running.",
    detail: "TrustINN wizard can start Docker Desktop for you.",
    buttons: ["Start Docker", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });

  if (result !== 0) {
    return false;
  }

  try {
    startDockerDesktopWithCmd();
    return true;
  } catch (error) {
    showErrorDialog(
      "Unable To Start Docker",
      error instanceof Error ? error.message : "Failed to launch Docker Desktop"
    );
    return false;
  }
}

async function waitForDockerToBeReady(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (isDockerRunning()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return false;
}

async function chooseResultsDirectory(currentValue) {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return { ok: false, error: "Main window is not available" };
  }

  let selectedPath = currentValue && fs.existsSync(currentValue) ? currentValue : "";

  while (!selectedPath) {
    const picked = await dialog.showOpenDialog(mainWindow, {
      title: "Choose Download Folder",
      buttonLabel: "Use This Folder",
      defaultPath: currentValue || DEFAULT_RESULTS_DIR,
      properties: ["openDirectory", "createDirectory"],
    });

    if (!picked.canceled && picked.filePaths.length > 0) {
      selectedPath = picked.filePaths[0];
      break;
    }

    const retry = dialog.showMessageBoxSync(mainWindow, {
      type: "warning",
      title: "Download Folder Required",
      message: "You must select a download folder in setup wizard.",
      detail: "This folder is used to save generated reports and output files.",
      buttons: ["Select Folder", "Exit Setup"],
      defaultId: 0,
      cancelId: 1,
    });

    if (retry === 1) {
      return { ok: false, error: "Setup cancelled because no download folder was selected" };
    }
  }

  try {
    fs.mkdirSync(selectedPath, { recursive: true });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unable to create selected download folder",
    };
  }

  return { ok: true, resultsDir: selectedPath };
}

function pullDockerImage(onProgress) {
  return new Promise((resolve, reject) => {
    // TODO: TEMPORARY WORKAROUND - Remove after Docker image supports ARM64
    // On macOS with Apple Silicon (ARM64), use platform override to pull x86_64 version
    const isAppleSilicon = process.arch === "arm64" && process.platform === "darwin";
    const pullArgs = isAppleSilicon ? ["pull", "--platform", "linux/amd64", DOCKER_IMAGE] : ["pull", DOCKER_IMAGE];
    
    if (isAppleSilicon) {
      console.log("[SETUP] Apple Silicon detected - pulling with platform override to linux/amd64");
    }
    
    const proc = spawn("docker", pullArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

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
      if (onProgress) onProgress(approxProgress);
    };

    proc.stdout.on("data", (chunk) => {
      String(chunk).split(/\r?\n/).forEach(parseLine);
    });

    proc.stderr.on("data", (chunk) => {
      String(chunk).split(/\r?\n/).forEach(parseLine);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve(true);
        return;
      }
      reject(new Error(`Docker pull failed with code ${code}\n${output.trim()}`));
    });

    proc.on("error", (error) => {
      reject(error);
    });
  });
}

async function initializeSetup() {
  console.log("[SETUP] Starting TrustINN setup wizard...");
  emitSetupEvent("setup:wizard-start");
  setSetupStatus("Starting setup wizard...", 2);

  if (!isDockerInstalled()) {
    setSetupStatus("Docker Desktop is not installed.", 5);
    const installing = promptDockerInstall();
    if (!installing) {
      emitSetupEvent("setup:error", { message: "Docker is required to run TrustINN." });
      return { success: false, error: "Docker is required to run TrustINN" };
    }
    emitSetupEvent("setup:error", { message: "Install Docker Desktop and restart TrustINN." });
    return { success: false, error: "Please restart the application after installing Docker" };
  }

  setSetupStatus("Docker Desktop found.", 12);

  if (!isDockerRunning()) {
    setSetupStatus("Docker is not running. Starting Docker Desktop...", 18);
    const started = promptStartDocker();
    if (!started) {
      emitSetupEvent("setup:error", { message: "Docker daemon must be running." });
      return { success: false, error: "Docker daemon must be running" };
    }

    setSetupStatus("Waiting for Docker engine to be ready...", 26);
    const ready = await waitForDockerToBeReady();
    if (!ready) {
      emitSetupEvent("setup:error", { message: "Docker failed to start in time." });
      return { success: false, error: "Docker failed to start. Please check Docker Desktop." };
    }
  }

  setSetupStatus("Docker engine is running.", 35);

  const config = parseConfig();
  setSetupStatus("Select where TrustINN should save output files.", 45);
  const folderResult = await chooseResultsDirectory(config.resultsDir);
  if (!folderResult.ok) {
    emitSetupEvent("setup:error", { message: folderResult.error });
    return { success: false, error: folderResult.error };
  }

  const nextConfig = {
    ...config,
    resultsDir: folderResult.resultsDir,
  };
  writeConfig(nextConfig);
  setSetupStatus("Download folder saved.", 55);

  const imageExists = isDockerImagePresentLocally();
  if (imageExists) {
    setSetupStatus("Docker image already exists. Skipping pull.", 100);
    emitSetupEvent("setup:pull-complete");
    return { success: true, config: nextConfig };
  }

  setSetupStatus("Docker image not found. Pulling image tag...", 60);
  emitSetupEvent("setup:pulling-image");

  try {
    await pullDockerImage((progress) => {
      emitSetupEvent("setup:pull-progress", progress);
      setSetupStatus("Pulling TrustINN Docker image...", Math.min(99, 60 + Math.floor(progress * 0.4)));
    });

    setSetupStatus("Setup complete. TrustINN is ready.", 100);
    emitSetupEvent("setup:pull-complete");
    return { success: true, config: nextConfig };
  } catch (error) {
    console.error("[SETUP] Error pulling Docker image:", error);
    const message = error instanceof Error ? error.message : "Failed to pull Docker image";
    emitSetupEvent("setup:error", { message });
    showErrorDialog(
      "Docker Image Pull Failed",
      `Failed to pull TrustINN Docker image:\n${message}\n\nPlease check your internet connection and restart the application.`
    );
    return { success: false, error: message };
  }
}

module.exports = {
  initializeSetup,
  parseConfig,
  writeConfig,
  isDockerInstalled,
  isDockerRunning,
  isDockerImagePresentLocally,
  pullDockerImage,
  DOCKER_IMAGE,
  CONFIG_FILE,
  CONFIG_DIR,
  DEFAULT_RESULTS_DIR,
};
