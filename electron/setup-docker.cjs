/* eslint-disable @typescript-eslint/no-require-imports */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { app, dialog, BrowserWindow } = require("electron");

const CONFIG_DIR = path.join(os.homedir(), "AppData", "Roaming", "TrustINN");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.ini");
const DOCKER_IMAGE = "rajeshbyreddy95/trustinn-tools:4.1.2";

// Parse INI config file
function parseConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return { resultsDir: path.join(os.homedir(), "Downloads", "TrustinnDownloads") };
    }
    
    const content = fs.readFileSync(CONFIG_FILE, "utf-8");
    const config = {};
    
    content.split("\n").forEach((line) => {
      const [key, value] = line.split("=");
      if (key && value) {
        config[key.trim()] = value.trim();
      }
    });
    
    return config;
  } catch (error) {
    console.error("Error parsing config:", error);
    return { resultsDir: path.join(os.homedir(), "Downloads", "TrustinnDownloads") };
  }
}

// Check if Docker is installed
function isDockerInstalled() {
  try {
    execSync("docker --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Check if Docker daemon is running
function isDockerRunning() {
  try {
    execSync("docker ps", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

// Show error dialog
function showErrorDialog(title, message) {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    dialog.showErrorDialog(mainWindow, title, message);
  }
}

// Show info dialog
function showInfoDialog(title, message) {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (mainWindow) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title,
      message,
      buttons: ["OK"],
    });
  }
}

// Check/Download Docker Desktop
function promptDockerInstall() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return false;

  const result = dialog.showMessageBoxSync(mainWindow, {
    type: "warning",
    title: "Docker Not Installed",
    message: "Docker Desktop is required to run TrustINN.",
    detail: "TrustINN uses Docker to run analysis tools. Please install Docker Desktop and try again.",
    buttons: ["Download Docker", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });

  if (result === 0) {
    require("electron").shell.openExternal("https://www.docker.com/products/docker-desktop");
  }

  return result === 0;
}

// Prompt to start Docker
function promptStartDocker() {
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) return false;

  const result = dialog.showMessageBoxSync(mainWindow, {
    type: "warning",
    title: "Docker Not Running",
    message: "Docker Desktop is not running.",
    detail: "Please start Docker Desktop and try again.",
    buttons: ["Start Docker", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });

  if (result === 0) {
    try {
      // Try to launch Docker Desktop on Windows
      const dockerDesktopPath = path.join(
        process.env.ProgramFiles || "C:\\Program Files",
        "Docker\\Docker\\Docker Desktop.exe"
      );
      
      if (fs.existsSync(dockerDesktopPath)) {
        require("child_process").spawn(dockerDesktopPath, { detached: true });
        return true;
      }
    } catch (error) {
      console.error("Error starting Docker:", error);
    }
  }

  return false;
}

// Pull Docker image with progress
function pullDockerImage(onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["pull", DOCKER_IMAGE], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    let totalLayers = 0;
    let completedLayers = 0;

    proc.stdout.on("data", (chunk) => {
      output += String(chunk);

      // Parse Docker pull output for progress
      const lines = output.split("\n");
      
      lines.forEach((line) => {
        // Docker pull format: "hash: Pulling from repo..."
        if (line.includes("Pulling from")) {
          const match = line.match(/^(\w+):\s+Pulling from/);
          if (match && !totalLayers) {
            totalLayers = Math.max(1, totalLayers + 1);
          }
        }

        // Track download progress: "hash: Downloading" or "hash: Verifying checksum"
        if (line.includes("Downloading") || line.includes("Pull complete") || line.includes("Digest")) {
          completedLayers = Math.min(totalLayers, completedLayers + 1);
          const progress = totalLayers > 0 
            ? Math.min(100, Math.floor((completedLayers / totalLayers) * 100))
            : Math.floor((output.split("\n").length / 50) * 100);
          
          if (onProgress) onProgress(Math.min(progress, 99));
        }
      });
    });

    proc.stderr.on("data", (chunk) => {
      output += String(chunk);
    });

    proc.on("close", (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve(true);
      } else {
        reject(new Error(`Docker pull failed with code ${code}`));
      }
    });

    proc.on("error", (error) => {
      reject(error);
    });
  });
}

// Initialize setup on app start
async function initializeSetup() {
  console.log("[SETUP] Starting TrustINN setup initialization...");

  // Check if Docker is installed
  if (!isDockerInstalled()) {
    console.log("[SETUP] Docker not installed");
    const installed = promptDockerInstall();
    if (!installed) {
      return { success: false, error: "Docker is required to run TrustINN" };
    }
    // Don't continue - user needs to install Docker first
    return { success: false, error: "Please restart the application after installing Docker" };
  }

  console.log("[SETUP] Docker is installed");

  // Check if Docker daemon is running
  if (!isDockerRunning()) {
    console.log("[SETUP] Docker daemon not running");
    const started = promptStartDocker();
    if (!started) {
      return { success: false, error: "Docker daemon must be running" };
    }
    
    // Wait for Docker to start
    console.log("[SETUP] Waiting for Docker to start...");
    for (let i = 0; i < 30; i++) {
      if (isDockerRunning()) {
        console.log("[SETUP] Docker started successfully");
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    if (!isDockerRunning()) {
      return { success: false, error: "Docker failed to start. Please check Docker Desktop." };
    }
  }

  console.log("[SETUP] Docker is running");

  // Check if image exists locally
  try {
    execSync(`docker inspect ${DOCKER_IMAGE}`, { stdio: "pipe" });
    console.log("[SETUP] Docker image already exists locally");
    return { success: true, config: parseConfig() };
  } catch {
    // Image doesn't exist, need to pull it
    console.log("[SETUP] Docker image not found, pulling...");
  }

  // Show setup window to user with progress
  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) {
    console.error("[SETUP] No main window found");
    return { success: false, error: "Application window not available" };
  }

  try {
    // Send IPC event to show setup dialog
    mainWindow.webContents.send("setup:pulling-image");

    await new Promise((resolve, reject) => {
      pullDockerImage((progress) => {
        mainWindow.webContents.send("setup:pull-progress", progress);
      })
        .then(resolve)
        .catch(reject);
    });

    console.log("[SETUP] Docker image pulled successfully");
    mainWindow.webContents.send("setup:pull-complete");
    
    return { success: true, config: parseConfig() };
  } catch (error) {
    console.error("[SETUP] Error pulling Docker image:", error);
    showErrorDialog(
      "Docker Image Pull Failed",
      `Failed to pull TrustINN Docker image: ${error.message}\n\nPlease check your internet connection and restart the application.`
    );
    return { success: false, error: error.message };
  }
}

module.exports = {
  initializeSetup,
  parseConfig,
  isDockerInstalled,
  isDockerRunning,
  pullDockerImage,
  DOCKER_IMAGE,
  CONFIG_FILE,
  CONFIG_DIR,
};
