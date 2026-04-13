"use client";

import { useEffect, useState } from "react";

export function SetupModal() {
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("Initializing...");
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    // Listen for setup events from Electron main process
    if (typeof window !== "undefined" && window.electronAPI) {

      const handlePullingImage = () => {
        setIsVisible(true);
        setIsError(false);
        setProgress(5);
        setMessage("Pulling TrustINN Docker image...");
      };

      const handleWizardStart = () => {
        setIsVisible(true);
        setIsError(false);
        setProgress(2);
        setMessage("Starting setup wizard...");
      };

      const handleStatus = (payload: { message?: string; progress?: number }) => {
        setIsVisible(true);
        setIsError(false);
        if (typeof payload?.progress === "number") {
          setProgress(Math.max(0, Math.min(100, payload.progress)));
        }
        if (payload?.message) {
          setMessage(payload.message);
        }
      };

      const handleError = (payload: { message?: string }) => {
        setIsVisible(true);
        setIsError(true);
        setMessage(payload?.message || "Setup failed. Please try again.");
      };

      const handleProgress = (percentage: number) => {
        setProgress(percentage);
        if (percentage < 30) setMessage("Downloading image layers (1/3)...");
        else if (percentage < 60) setMessage("Downloading image layers (2/3)...");
        else if (percentage < 100) setMessage("Downloading image layers (3/3)...");
      };

      const handleComplete = () => {
        setProgress(100);
        setIsError(false);
        setMessage("Setup complete! Loading application...");
        setTimeout(() => {
          setIsVisible(false);
        }, 1500);
      };

      // Subscribe to IPC events
      window.electronAPI?.onSetupPullingImage?.(handlePullingImage);
      window.electronAPI?.onSetupProgress?.(handleProgress);
      window.electronAPI?.onSetupWizardStart?.(handleWizardStart);
      window.electronAPI?.onSetupStatus?.(handleStatus);
      window.electronAPI?.onSetupError?.(handleError);
      window.electronAPI?.onSetupComplete?.(handleComplete);

      return () => {
        // Cleanup listeners
      };
    }
  }, []);

  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 shadow-xl">
        <div className="flex flex-col items-center gap-4">
          <h2 className="text-xl font-bold text-gray-800">Setting up TrustINN</h2>
          
          <div className="w-full">
            <p className="text-sm text-gray-600 mb-2">{message}</p>
            
            {/* Progress Bar */}
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className={`${isError ? "bg-red-500" : "bg-blue-500"} h-full transition-all duration-300 ease-out`}
                style={{ width: `${progress}%` }}
              />
            </div>
            
            {/* Progress Percentage */}
            <p className="text-xs text-gray-500 mt-2 text-right">{progress}%</p>
          </div>

          <div className="text-sm text-gray-600 text-center">
            <p>Please wait while wizard setup prepares TrustINN.</p>
            <p className="text-xs text-gray-500 mt-1">Docker check, folder setup, and image pull run here.</p>
          </div>

          {/* Animated Dots */}
          {!isError && (
            <div className="flex gap-1 justify-center">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0s" }} />
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0.15s" }} />
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: "0.3s" }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
