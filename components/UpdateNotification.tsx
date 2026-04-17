"use client";

import { useEffect, useState } from "react";
import { FiDownload, FiX } from "react-icons/fi";

interface UpdateInfo {
  version: string;
  files: Array<{ url: string; sha512: string; size: number }>;
  path: string;
  sha512: string;
  releaseDate: string;
}

interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

interface ElectronAPI {
  onUpdateAvailable?: (callback: (info: UpdateInfo) => void) => void;
  onUpdateProgress?: (callback: (progress: DownloadProgress) => void) => void;
  onUpdateDownloaded?: (callback: () => void) => void;
  onUpdateNotAvailable?: (callback: (info: any) => void) => void;
  onUpdateError?: (callback: (error: any) => void) => void;
  checkForUpdates?: () => Promise<any>;
}

export function UpdateNotification() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && (window as unknown as { electronAPI?: ElectronAPI }).electronAPI) {
      const handleUpdateAvailable = (info: UpdateInfo) => {
        console.log("Update available:", info);
        setUpdateInfo(info);
        setUpdateAvailable(true);
      };

      const handleDownloadProgress = (progress: DownloadProgress) => {
        setDownloadProgress(progress);
        setIsDownloading(true);
      };

      const handleUpdateDownloaded = () => {
        setIsDownloading(false);
        setDownloadProgress(null);
      };

      const electronAPI = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
      electronAPI?.onUpdateAvailable?.(handleUpdateAvailable);
      electronAPI?.onUpdateProgress?.(handleDownloadProgress);
      electronAPI?.onUpdateDownloaded?.(handleUpdateDownloaded);
    }
  }, []);

  if (!updateAvailable || dismissed) {
    return null;
  }

  const progressPercent = downloadProgress?.percent ?? 0;
  const speedMBps = downloadProgress ? (downloadProgress.bytesPerSecond / 1024 / 1024).toFixed(2) : "0";

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-lg border-l-4 border-blue-500 overflow-hidden z-40 max-w-sm">
      <div className="p-4">
        {/* Header */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <FiDownload className="text-blue-500 text-xl" />
            <div>
              <h3 className="font-semibold text-gray-800">Update Available</h3>
              <p className="text-xs text-gray-500">Version {updateInfo?.version}</p>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-gray-400 hover:text-gray-600 transition"
            aria-label="Dismiss"
          >
            <FiX className="text-lg" />
          </button>
        </div>

        {/* Progress or Action */}
        {isDownloading ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-600">Downloading update...</span>
              <span className="text-blue-600 font-medium">{progressPercent}%</span>
            </div>
            
            {/* Progress Bar */}
            <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <p className="text-xs text-gray-500">
              Speed: {speedMBps} MB/s
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              A new version of TrustINN Desktop is available. Click below to update.
            </p>
            
            <button
              onClick={async () => {
                setIsDownloading(true);
                try {
                  await (window as any).electronAPI?.quitAndInstall?.();
                } catch (error) {
                  console.error("Update failed:", error);
                  setIsDownloading(false);
                }
              }}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white font-medium py-2 px-4 rounded transition"
            >
              Update Now
            </button>

            <button
              onClick={() => setDismissed(true)}
              className="w-full text-gray-600 hover:text-gray-800 text-sm py-1 transition"
            >
              Remind me later
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function CheckForUpdateButton() {
  const [isChecking, setIsChecking] = useState(false);
  const [lastChecked, setLastChecked] = useState<string>("");

  const handleCheckForUpdates = async () => {
    setIsChecking(true);
    try {
      const result = await (window as any).electronAPI?.checkForUpdates?.();
      if (result?.ok) {
        if (result.updateAvailable) {
          console.log("Update available:", result.version);
          // Update notification will appear automatically
        } else {
          setLastChecked("✓ You're up to date!");
          setTimeout(() => setLastChecked(""), 3000);
        }
      }
    } catch (error) {
      console.error("Update check error:", error);
      setLastChecked("⚠️ Check failed");
      setTimeout(() => setLastChecked(""), 3000);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <button
      onClick={handleCheckForUpdates}
      disabled={isChecking}
      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
        bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 
        hover:from-blue-100 hover:to-indigo-100 hover:border-blue-300
        active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
      title="Check for application updates"
    >
      <FiDownload className={`text-base ${isChecking ? "animate-spin" : ""}`} />
      <span>{isChecking ? "Checking..." : "Check Updates"}</span>
      {lastChecked && <span className="text-xs ml-1 text-gray-600">{lastChecked}</span>}
    </button>
  );
}
