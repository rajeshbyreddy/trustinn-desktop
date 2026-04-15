/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

async function safeInvoke(primaryChannel, payload, fallbackChannel) {
  try {
    return await ipcRenderer.invoke(primaryChannel, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (fallbackChannel && message.includes("No handler registered")) {
      return ipcRenderer.invoke(fallbackChannel, payload);
    }
    throw error;
  }
}

contextBridge.exposeInMainWorld("electronAPI", {
  ping: () => ipcRenderer.invoke("app:ping"),
  navigate: (route) => ipcRenderer.invoke("app:navigate", route),
  pickFile: () => ipcRenderer.invoke("tools:pick-file"),
  pickFolder: () => ipcRenderer.invoke("tools:pick-folder"),
  stopRun: () => ipcRenderer.invoke("tools:stop-run"),
  readFile: (filePath) => ipcRenderer.invoke("tools:read-file", filePath),
  writeTempFile: (content, language) => ipcRenderer.invoke("tools:write-temp-file", { content, language }),
  deleteTempFile: (filePath) => ipcRenderer.invoke("tools:delete-temp-file", filePath),
  listSamples: (payload) => {
    if (payload?.language === "c") {
      return safeInvoke("tools:list-samples", payload, "tools:list-c-samples");
    }
    return safeInvoke("tools:list-samples", payload);
  },
  runTool: (payload) => {
    if (payload?.language === "c") {
      return safeInvoke("tools:run-tool", payload, "tools:run-c-tool");
    }
    return safeInvoke("tools:run-tool", payload);
  },
  listCSamples: (payload) => ipcRenderer.invoke("tools:list-c-samples", payload),
  runCTool: (payload) => ipcRenderer.invoke("tools:run-c-tool", payload),
  checkDockerStatus: () => ipcRenderer.invoke("docker:check-status"),
  removeDockerImage: (imageName) => ipcRenderer.invoke("tools:remove-docker-image", imageName),
  checkDockerImageExists: (imageName) => ipcRenderer.invoke("docker:check-image-exists", imageName),
  pullDockerImage: (imageName) => ipcRenderer.invoke("docker:pull-image", imageName),
  stopDockerPullImage: () => ipcRenderer.invoke("docker:stop-pull-image"),
  
  // Setup event listeners
  onSetupPullingImage: (callback) => ipcRenderer.on("setup:pulling-image", callback),
  onSetupProgress: (callback) => ipcRenderer.on("setup:pull-progress", (_event, progress) => callback(progress)),
  onSetupStatus: (callback) => ipcRenderer.on("setup:status", (_event, payload) => callback(payload)),
  onSetupError: (callback) => ipcRenderer.on("setup:error", (_event, payload) => callback(payload)),
  onSetupWizardStart: (callback) => ipcRenderer.on("setup:wizard-start", callback),
  onSetupComplete: (callback) => ipcRenderer.on("setup:pull-complete", callback),
  
  // Auto-update listeners
  onUpdateAvailable: (callback) => ipcRenderer.on("update:available", (_event, info) => callback(info)),
  onUpdateProgress: (callback) => ipcRenderer.on("update:progress", (_event, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on("update:downloaded", callback),
  quitAndInstall: () => ipcRenderer.invoke("update:quit-and-install"),
  
  // Code execution live output
  onCodeOutputLive: (callback) => ipcRenderer.on("code-output-live", (_event, payload) => callback(payload)),
});
