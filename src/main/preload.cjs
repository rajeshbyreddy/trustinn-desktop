const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("trustinn", {
  listSamples: async (payload) => {
    return await ipcRenderer.invoke("list-samples", payload);
  },
  runTool: async (payload) => {
    return await ipcRenderer.invoke("run-tool", payload);
  },
  openFileDialog: async (payload) => {
    return await ipcRenderer.invoke("open-file-dialog", payload);
  },
  openDownloads: async () => {
    return await ipcRenderer.invoke("open-downloads");
  },
  onToolOutput: (callback) => {
    ipcRenderer.on("tool-output", (event, data) => callback(data));
  },
  offToolOutput: () => {
    ipcRenderer.removeAllListeners("tool-output");
  }
});
