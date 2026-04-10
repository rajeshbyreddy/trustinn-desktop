import React, { useMemo, useState, useEffect, useRef } from "react";

const EXTENSIONS = {
  c: "c",
  java: "java",
  python: "py",
  solidity: "sol"
};

const TOOLS = {
  c: [
    { value: "Condition Satisfiability Analysis", label: "CC-Bounded Model Checker" },
    { value: "DSE based Mutation Analyser", label: "DSE Mutation Analyser" },
    { value: "Dynamic Symbolic Execution", label: "Dynamic Symbolic Execution" },
    { value: "Dynamic Symbolic Execution with Pruning", label: "DSE with Pruning" },
    { value: "Advance Code Coverage Profiler", label: "Advance Code Coverage Profiler" },
    { value: "Mutation Testing Profiler", label: "Mutation Testing Profiler" },
  ],
  java: [{ value: "JBMC", label: "JBMC — Java Bounded Model Checker" }],
  python: [{ value: "Condition Coverage Fuzzing", label: "Condition Coverage Fuzzing" }],
  solidity: [{ value: "VeriSol", label: "Solidity — Smart Contract Verifier" }],
};

const S = {
  select: {
    height: 32,
    borderRadius: 6,
    border: "0.5px solid var(--color-border-secondary, #cbd5e1)",
    padding: "0 10px",
    background: "var(--color-background-secondary, #f8f9fa)",
    fontSize: 12,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    color: "var(--color-text-primary, #111)",
    outline: "none",
    width: "100%",
  },
  input: {
    height: 32,
    borderRadius: 6,
    border: "0.5px solid var(--color-border-secondary, #cbd5e1)",
    padding: "0 10px",
    background: "var(--color-background-secondary, #f8f9fa)",
    fontSize: 12,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    color: "var(--color-text-primary, #111)",
    outline: "none",
    width: "100%",
  },
};

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body, #root { height: 96vh; overflow: hidden; }
  body { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace; background: var(--color-background-tertiary, #f1f5f9); }

  .app-root { display: flex; flex-direction: column; height: 96vh; overflow: hidden; }

  /* Header */
  .hdr { display: flex; align-items: center; justify-content: space-between; padding: 11px 20px; background: var(--color-background-primary, #fff); border-bottom: 0.5px solid var(--color-border-tertiary, #e2e8f0); flex-shrink: 0; }
  .hdr-left { display: flex; align-items: center; gap: 12px; }
  .logo-box { width: 28px; height: 28px; border-radius: 8px; background: #534AB7; display: flex; align-items: center; justify-content: center; }
  .logo-box span { color: #fff; font-size: 12px; font-weight: 600; }
  .brand-name { font-size: 14px; font-weight: 500; color: var(--color-text-primary, #111); letter-spacing: -0.2px; }
  .brand-sub { font-size: 10px; color: var(--color-text-secondary, #64748b); font-weight: 400; margin-left: 4px; vertical-align: middle; }
  .hdr-badge { font-size: 10px; padding: 3px 10px; border-radius: 20px; background: var(--color-background-secondary, #f1f5f9); border: 0.5px solid var(--color-border-tertiary, #e2e8f0); color: var(--color-text-secondary, #64748b); }

  /* Tabs */
  .tabs-bar { display: flex; gap: 2px; padding: 8px 20px 0; background: var(--color-background-primary, #fff); border-bottom: 0.5px solid var(--color-border-tertiary, #e2e8f0); flex-shrink: 0; }
  .tab-btn { padding: 7px 16px; border: none; background: transparent; font-size: 12px; font-family: inherit; color: var(--color-text-secondary, #64748b); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -0.5px; transition: color 0.15s, border-color 0.15s; }
  .tab-btn:hover { color: var(--color-text-primary, #111); }
  .tab-btn.active { color: #534AB7; border-bottom-color: #534AB7; font-weight: 500; }

  /* Body split */
  .body-split { display: flex; height: 100%; overflow: hidden; }

  /* Controls panel */
  .ctrl-panel { flex: 0 0 40%; max-width: 40%; display: flex; flex-direction: column; background: var(--color-background-primary, #fff); border-right: 0.5px solid var(--color-border-tertiary, #e2e8f0); overflow-y: auto; }
  .ctrl-section { padding: 14px 18px; border-bottom: 0.5px solid var(--color-border-tertiary, #e2e8f0); }
  .sec-label { font-size: 10px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--color-text-tertiary, #94a3b8); margin-bottom: 10px; }
  .field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
  .field:last-child { margin-bottom: 0; }
  .field label { font-size: 11px; color: var(--color-text-secondary, #64748b); }
  .field select:focus, .field input:focus { border-color: #534AB7 !important; box-shadow: 0 0 0 2px rgba(83,74,183,0.12); }
  .inline-row { display: flex; gap: 8px; align-items: center; }
  .inline-row select { flex: 1; }

  .param-card { background: var(--color-background-secondary, #f8f9fa); border-radius: 8px; border: 0.5px solid var(--color-border-tertiary, #e2e8f0); padding: 12px; }
  .param-card .field { margin-bottom: 8px; }
  .param-card .field:last-child { margin-bottom: 0; }
  .warn-box { font-size: 11px; color: #854F0B; background: #FAEEDA; border-radius: 6px; padding: 8px 10px; border: 0.5px solid #FAC775; margin-top: 8px; line-height: 1.5; }

  .btn-ghost { height: 32px; padding: 0 14px; border-radius: 6px; border: 0.5px solid var(--color-border-secondary, #cbd5e1); background: var(--color-background-secondary, #f1f5f9); font-size: 11px; font-family: inherit; color: var(--color-text-primary, #111); cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: background 0.1s; }
  .btn-ghost:hover { background: var(--color-background-tertiary, #e2e8f0); }
  .btn-ghost:disabled { opacity: 0.45; cursor: not-allowed; }

  .ctrl-spacer { flex: 1; }
  .exec-bar { padding: 14px 18px; border-top: 0.5px solid var(--color-border-tertiary, #e2e8f0); flex-shrink: 0; background: var(--color-background-primary, #fff); }
  .btn-exec { width: 100%; height: 36px; border-radius: 8px; border: none; background: #534AB7; color: #fff; font-size: 13px; font-family: inherit; font-weight: 500; cursor: pointer; letter-spacing: 0.02em; transition: background 0.15s, transform 0.1s; }
  .btn-exec:hover { background: #3C3489; }
  .btn-exec:active { transform: scale(0.98); }
  .btn-exec:disabled { background: var(--color-background-tertiary, #e2e8f0); color: var(--color-text-tertiary, #94a3b8); cursor: not-allowed; transform: none; }
  .status-txt { font-size: 11px; margin-top: 7px; min-height: 15px; }
  .status-txt.ok { color: #3B6D11; }
  .status-txt.err { color: #A32D2D; }
  .status-txt.idle { color: var(--color-text-secondary, #64748b); }

  /* Terminal */
  .terminal { flex: 0 0 60%; max-width: 60%; display: flex; flex-direction: column; background: #18181A; overflow: hidden; }
  .term-titlebar { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 0.5px solid rgba(255,255,255,0.06); flex-shrink: 0; background: #1E1E21; }
  .term-dots { display: flex; gap: 6px; }
  .term-dot { width: 10px; height: 10px; border-radius: 50%; }
  .term-label { font-size: 11px; color: rgba(255,255,255,0.3); margin-left: 4px; }
  .term-body { flex: 1; overflow-y: auto; padding: 14px 18px; font-size: 12.5px; line-height: 1.75; color: #C9D1D9; white-space: pre-wrap; }
  .term-body div { white-space: pre; }
  .term-body::-webkit-scrollbar { width: 4px; }
  .term-body::-webkit-scrollbar-track { background: transparent; }
  .term-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }
  .t-prompt { color: #7c6fde; }
  .t-dim { color: rgba(255,255,255,0.25); }
  .t-ok { color: #57c87a; }
  .t-err { color: #f07070; }
  .t-cursor { display: inline-block; width: 7px; height: 13px; background: rgba(255,255,255,0.45); vertical-align: middle; animation: blink 1.1s step-end infinite; }
  .t-spinner { display: inline-block; width: 11px; height: 11px; border: 1.5px solid rgba(255,255,255,0.1); border-top-color: #79c0ff; border-radius: 50%; animation: spin 0.7s linear infinite; vertical-align: middle; margin-right: 6px; }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  @keyframes spin { to { transform: rotate(360deg); } }
`;

export default function App() {
  const [currentTab, setCurrentTab] = useState("c");
  const [toolValues, setToolValues] = useState({ c: "", java: "", python: "", solidity: "" });
  const [samples, setSamples] = useState([]);
  const [selectedSample, setSelectedSample] = useState("");
  const [status, setStatus] = useState({ msg: "", type: "idle" });
  const [isLoading, setIsLoading] = useState(false);
  const [termLines, setTermLines] = useState([
    { type: "dim", text: "// Trustinn Tool Runner v1.0" },
    { type: "dim", text: "// Select a tool and sample to begin." },
    { type: "blank" },
  ]);

  const [cbmcBound, setCbmcBound] = useState("5");
  const [kleemaValue, setKleemaValue] = useState("1");
  const [gmcovVersion, setGmcovVersion] = useState("4");
  const [gmcovTimebound, setGmcovTimebound] = useState("60");
  const [gmutantVersion, setGmutantVersion] = useState("4");
  const [gmutantTimebound, setGmutantTimebound] = useState("60");
  const [solidityMode, setSolidityMode] = useState("bmc");
  const dockerOnlyMode = true;

  const termRef = useRef(null);
  const currentTool = toolValues[currentTab] || "";

  useEffect(() => {
    setSamples([]);
    setSelectedSample("");
    setStatus({ msg: "", type: "idle" });
    clearTerm();
  }, [currentTab, currentTool]);

  useEffect(() => {
    if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [termLines]);

  const addLine = (type, text) => {
    setTermLines(prev => [...prev, { type, text }]);
  };

  const clearTerm = () => {
    setTermLines([{ type: "dim", text: "// session cleared" }, { type: "blank" }]);
  };

  const api = window.trustinn;

  const handleTabChange = (tab) => {
    setCurrentTab(tab);
    clearTerm();
  };

  const handleToolChange = (value) => {
    setToolValues(prev => ({ ...prev, [currentTab]: value }));
    setSamples([]);
    setSelectedSample("");
    setStatus({ msg: "", type: "idle" });
  };

  const handleLoadSamples = async () => {
    if (!currentTool) { setStatus({ msg: "Select a tool first.", type: "err" }); return; }
    if (!api) {
      setStatus({ msg: "IPC bridge not available.", type: "err" });
      addLine("err", "error: IPC bridge not available (window.trustinn)");
      return;
    }
    setIsLoading(true);
    setStatus({ msg: "Loading samples...", type: "idle" });
    addLine("info", `loading samples for [${currentTool}]...`);
    try {
      const list = await api.listSamples({ language: currentTab, tool: currentTool });
      setSamples(list);
      setSelectedSample("");
      setStatus({ msg: list.length ? `${list.length} sample(s) loaded.` : "No samples found.", type: list.length ? "ok" : "idle" });
     
    } catch (err) {
      setStatus({ msg: err?.message || "Failed to load samples.", type: "err" });
      addLine("err", `error: ${err?.message || "failed to load samples"}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFile = async () => {
    if (!currentTool) { setStatus({ msg: "Select a tool first.", type: "err" }); return; }
    if (!api) {
      setStatus({ msg: "IPC bridge not available.", type: "err" });
      return;
    }
    try {
      const filePath = await api.openFileDialog({ 
        language: currentTab,
        extension: EXTENSIONS[currentTab]
      });
      if (filePath) {
        setSelectedSample(filePath);
        setStatus({ msg: `File selected: ${filePath}`, type: "ok" });
        addLine("info", `selected: ${filePath}`);
      }
    } catch (err) {
      setStatus({ msg: err?.message || "Failed to select file.", type: "err" });
    }
  };

  const handleExecute = async () => {
    if (!currentTool) { setStatus({ msg: "Select a tool first.", type: "err" }); return; }
    if (!selectedSample) { setStatus({ msg: "Select a sample file.", type: "err" }); return; }
    if (!api) {
      setStatus({ msg: "IPC bridge not available.", type: "err" });
      addLine("err", "error: IPC bridge not available");
      return;
    }
    clearTerm();
    setIsLoading(true);
    setStatus({ msg: "Running...", type: "idle" });
    const fileName = selectedSample.split("/").pop();
    addLine("info", `exec ${currentTool}`);
    addLine("dim", `  ← ${fileName}`);
    addLine("spinner", "executing...");

    const params = { cbmcBound, kleemaValue, gmcovVersion, gmcovTimebound, gmutantVersion, gmutantTimebound, solidityMode };
    
    // Set up real-time output listener
    const handleOutput = (data) => {
      setTermLines(prev => prev.filter(l => l.type !== "spinner"));
      if (data.type === "stdout" || data.type === "stderr") {
        const lines = data.data.split("\n");
        lines.forEach(line => {
          if (line.trim()) {
            addLine("plain", line);
          }
        });
      } else if (data.type === "completion") {
        addLine("ok", data.data);
      }
    };
    
    if (api.onToolOutput) {
      api.onToolOutput(handleOutput);
    }

    try {
      const result = await api.runTool({ language: currentTab, tool: currentTool, samplePath: selectedSample, params });
      setTermLines(prev => prev.filter(l => l.type !== "spinner"));
      setStatus({ msg: result.ok ? "Execution completed." : "Execution failed.", type: result.ok ? "ok" : "err" });
      addLine(result.ok ? "ok" : "err", result.ok ? "done: execution completed" : "fail: execution returned error");
    } catch (err) {
      setTermLines(prev => prev.filter(l => l.type !== "spinner"));
      setStatus({ msg: err?.message || "Execution failed.", type: "err" });
      addLine("err", `error: ${err?.message || "execution failed"}`);
    } finally {
      setIsLoading(false);
      // Clean up listener
      if (api.offToolOutput) {
        api.offToolOutput();
      }
    }
  };

  const isCov = currentTool === "Advance Code Coverage Profiler";
  const isMut = currentTool === "Mutation Testing Profiler";
  const showParams = currentTool === "Condition Satisfiability Analysis"
    || currentTool === "DSE based Mutation Analyser"
    || isCov || isMut
    || (currentTab === "solidity" && currentTool === "VeriSol");

  return (
    <>
      <style>{css}</style>
      <div className="app-root">
        {/* Header */}
        <header className="hdr">
          <div className="hdr-left">
            <div className="logo-box"><span>Ti</span></div>
            <span className="brand-name">
              Trustinn Desktop
              <sub className="brand-sub">Unified Tool Runner</sub>
            </span>
          </div>
          <span className="hdr-badge">● docker execution</span>
        </header>

        {/* Tabs */}
        <div className="tabs-bar">
          {[{ key: "c", label: "C Tools" }, { key: "java", label: "Java" }, { key: "python", label: "Python" }, { key: "solidity", label: "Solidity" }].map(t => (
            <button key={t.key} className={`tab-btn${currentTab === t.key ? " active" : ""}`} onClick={() => handleTabChange(t.key)}>{t.label}</button>
          ))}
        </div>

        {/* Body */}
        <div className="body-split">
          {/* Controls */}
          <div className="ctrl-panel">
            <div className="ctrl-section">
              <div className="sec-label">Tool selection</div>
              <div className="field">
                <label>Active tool</label>
                <select style={S.select} value={currentTool} onChange={e => handleToolChange(e.target.value)}>
                  <option value="">— select a tool —</option>
                  {(TOOLS[currentTab] || []).map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            <div className="ctrl-section">
              <div className="sec-label">Sample file</div>
              <div className="field">
                <div className="inline-row">
                  <button className="btn-ghost" onClick={handleLoadSamples} disabled={isLoading}>Load samples</button>
                  <button className="btn-ghost" onClick={handleSelectFile} disabled={isLoading || dockerOnlyMode}>Browse file</button>
                  <select style={{ ...S.select, flex: 1 }} value={selectedSample} onChange={e => setSelectedSample(e.target.value)}>
                    <option value="">— no file —</option>
                    {samples.map(s => <option key={s.path} value={s.path}>{s.name}</option>)}
                  </select>
                </div>
                {dockerOnlyMode && <div className="warn-box">Samples are fetched from Docker image only. Local file browsing is disabled.</div>}
              </div>
            </div>

            {showParams && (
              <div className="ctrl-section">
                <div className="sec-label">Parameters</div>
                <div className="param-card">
                  {currentTool === "Condition Satisfiability Analysis" && (
                    <div className="field">
                      <label>Unwind bound</label>
                      <input type="number" style={S.input} value={cbmcBound} onChange={e => setCbmcBound(e.target.value)} />
                    </div>
                  )}
                  {currentTool === "DSE based Mutation Analyser" && (
                    <div className="field">
                      <label>Tool value</label>
                      <select style={S.select} value={kleemaValue} onChange={e => setKleemaValue(e.target.value)}>
                        <option value="1">1</option>
                        <option value="2">2</option>
                      </select>
                    </div>
                  )}
                  {(isCov || isMut) && (
                    <>
                      <div className="field">
                        <label>Version</label>
                        <select style={S.select} value={isCov ? gmcovVersion : gmutantVersion} onChange={e => isCov ? setGmcovVersion(e.target.value) : setGmutantVersion(e.target.value)}>
                          <option value="4">4</option>
                        </select>
                      </div>
                      <div className="field">
                        <label>Time bound (seconds)</label>
                        <input type="number" style={S.input} value={isCov ? gmcovTimebound : gmutantTimebound} onChange={e => isCov ? setGmcovTimebound(e.target.value) : setGmutantTimebound(e.target.value)} />
                      </div>
                      {isMut && <div className="warn-box">⚠ Generates mutants from C source. Requires a main() function.</div>}
                    </>
                  )}
                  {currentTab === "solidity" && currentTool === "VeriSol" && (
                    <div className="field">
                      <label>Verification mode</label>
                      <select style={S.select} value={solidityMode} onChange={e => setSolidityMode(e.target.value)}>
                        <option value="bmc">Bounded Model Checker</option>
                        <option value="chc">Constrained Horn Clauses</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="ctrl-spacer" />

            <div className="exec-bar">
              <button className="btn-exec" onClick={handleExecute} disabled={isLoading}>▶ Execute tool</button>
              <div className={`status-txt ${status.type}`}>{status.msg}</div>
            </div>
          </div>

          {/* Terminal */}
          <div className="terminal">
            <div className="term-titlebar">
              <div className="term-dots">
                <div className="term-dot" style={{ background: "#FF5F57" }} />
                <div className="term-dot" style={{ background: "#FFBD2E" }} />
                <div className="term-dot" style={{ background: "#28CA41" }} />
              </div>
              <span className="term-label">output — trustinn runner</span>
            </div>
            <div className="term-body" ref={termRef}>
              {termLines.map((line, i) => {
                if (line.type === "blank") return <br key={i} />;
                if (line.type === "spinner") return <div key={i}><span className="t-spinner" /><span className="t-dim">{line.text}</span></div>;
                if (line.type === "plain") return <div key={i}>{line.text}</div>;
                return <div key={i}><span className={`t-${line.type}`}>{line.text}</span></div>;
              })}
              <div><span className="t-prompt">$ </span><span className="t-cursor" /></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
