export {};

declare global {
  interface Window {
    electronAPI?: {
      ping: () => Promise<{
        message: string;
        platform: string;
        date: string;
      }>;
      navigate: (route: string) => Promise<{ ok: boolean; error?: string }>;
      pickFile: () => Promise<
        | { ok: true; path: string }
        | { ok: false; canceled?: boolean; error?: string }
      >;
      stopRun: () => Promise<{ ok: boolean; stopped: boolean; error?: string }>;
      readFile: (filePath: string) => Promise<string>;
      writeTempFile: (content: string, language: string) => Promise<string>;
      deleteTempFile: (filePath: string) => Promise<boolean>;
      listSamples: (payload: {
        language: "c" | "solidity" | string;
        tool: string;
        image?: string;
        platform?: string;
      }) => Promise<{
        ok: boolean;
        samples: Array<{ name: string; path: string }>;
        raw: string;
        error?: string;
        command?: string;
      }>;
      runTool: (payload: {
        language: "c" | "solidity" | string;
        tool: string;
        sourceType: "sample" | "file";
        samplePath?: string;
        filePath?: string;
        params?: string;
        image?: string;
        platform?: string;
        resultsDir?: string;
      }) => Promise<{
        ok: boolean;
        output: string;
        command: string;
        exitCode?: number;
        resultsDir?: string;
        error?: string;
      }>;
      listCSamples: (payload: {
        tool: string;
        image?: string;
        platform?: string;
      }) => Promise<{
        ok: boolean;
        samples: string[];
        raw: string;
        error?: string;
        command?: string;
      }>;
      runCTool: (payload: {
        tool: string;
        sourceType: "sample" | "file";
        samplePath?: string;
        filePath?: string;
        params?: string;
        image?: string;
        platform?: string;
        resultsDir?: string;
      }) => Promise<{
        ok: boolean;
        output: string;
        command: string;
        exitCode?: number;
        resultsDir?: string;
        error?: string;
      }>;
      onSetupPullingImage: (callback: () => void) => void;
      onSetupProgress: (callback: (progress: number) => void) => void;
      onSetupStatus: (callback: (payload: { message?: string; progress?: number }) => void) => void;
      onSetupError: (callback: (payload: { message?: string }) => void) => void;
      onSetupWizardStart: (callback: () => void) => void;
      onSetupComplete: (callback: () => void) => void;
      onUpdateAvailable: (callback: (info: unknown) => void) => void;
      onUpdateProgress: (callback: (progress: unknown) => void) => void;
      onUpdateDownloaded: (callback: () => void) => void;
      quitAndInstall: () => Promise<unknown>;
    };
  }
}
