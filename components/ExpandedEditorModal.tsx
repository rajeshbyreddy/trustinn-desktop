'use client';

import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import { X, Terminal } from 'lucide-react';
import type { OnMount } from '@monaco-editor/react';
import type * as MonacoType from 'monaco-editor';

const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

interface ExpandedEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  code: string;
  onCodeChange: (code: string) => void;
  language: string;
}

export default function ExpandedEditorModal({
  isOpen,
  onClose,
  code,
  onCodeChange,
  language,
}: ExpandedEditorModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleEditorDidMount: OnMount = (_editor, monaco) => {
    const monacoApi = monaco as typeof MonacoType;

    monacoApi.editor.defineTheme('customTheme', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6B7280' },
        { token: 'keyword', foreground: '1D4ED8' },
        { token: 'string', foreground: '047857' },
        { token: 'number', foreground: '7C3AED' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#0f172a',
        'editor.lineHighlightBackground': '#f8fafc',
        'editor.selectionBackground': '#dbeafe',
        'editorCursor.foreground': '#0f172a',
        'editorWhitespace.foreground': '#cbd5e1',
        'editorIndentGuide.background': '#e2e8f0',
        'editorLineNumber.foreground': '#94a3b8',
      },
    });

    monacoApi.editor.setTheme('customTheme');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.35)' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&display=swap');
        .exp-term-modal { font-family: 'JetBrains Mono', monospace; background: #ffffff; border: 1px solid #dbe5f0; border-radius: 12px; width: 100%; max-width: 900px; height: 88vh; max-height: 750px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 18px 45px rgba(15,23,42,0.18), 0 2px 10px rgba(15,23,42,0.08); }
        .exp-term-titlebar { background: #f8fafc; border-bottom: 1px solid #dbe5f0; padding: 10px 16px; display: flex; align-items: center; gap: 10px; }
        .exp-term-dots { display: flex; gap: 6px; }
        .exp-term-dot { width: 11px; height: 11px; border-radius: 50%; }
        .exp-term-dot-r { background: #ff5f57; }
        .exp-term-dot-y { background: #febc2e; }
        .exp-term-dot-g { background: #28c840; }
        .exp-term-title { color: #0f172a; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; flex: 1; text-align: center; }
        .exp-term-close { background: none; border: none; color: #64748b; cursor: pointer; padding: 2px; transition: color 0.2s; }
        .exp-term-close:hover { color: #ff5f57; }
        .exp-code-container { flex: 1; overflow-y: auto; display: flex; flex-direction: column; position: relative; background: #ffffff; }
        .exp-code-container::-webkit-scrollbar { width: 4px; }
        .exp-code-container::-webkit-scrollbar-track { background: #f8fafc; }
        .exp-code-container::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
        .exp-term-footer { border-top: 1px solid #dbe5f0; padding: 12px 16px; background: #f8fafc; }
        .exp-term-footer-text { color: #475569; font-size: 10px; letter-spacing: 0.05em; }
      `}</style>

      <div className="exp-term-modal">
        <div className="exp-term-titlebar">
          <div className="exp-term-dots">
            <div className="exp-term-dot exp-term-dot-r" />
            <div className="exp-term-dot exp-term-dot-y" />
            <div className="exp-term-dot exp-term-dot-g" />
          </div>
          <Terminal size={12} color="#0369a1" />
          <span className="exp-term-title">expanded code reader</span>
          <button className="exp-term-close" onClick={onClose}><X size={14} /></button>
        </div>

        <div className="exp-code-container">
          <Editor
            height="100%"
            language={language}
            value={code}
            onChange={(value) => onCodeChange(value || '')}
            onMount={handleEditorDidMount}
            loading={<div style={{ color: '#475569', textAlign: 'center', paddingTop: '20px' }}>Loading editor...</div>}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              lineHeight: 22,
              fontFamily: "'JetBrains Mono', monospace",
              fontLigatures: true,
              lineNumbers: 'on',
              tabSize: language === 'python' ? 4 : 2,
              insertSpaces: true,
              detectIndentation: false,
              trimAutoWhitespace: true,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: 'off',
              wrappingIndent: 'none',
              formatOnPaste: true,
              formatOnType: true,
              autoClosingBrackets: 'always',
              autoClosingQuotes: 'always',
              matchBrackets: 'always',
              autoIndent: 'full',
              smoothScrolling: true,
              cursorSmoothCaretAnimation: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              guides: { indentation: true, bracketPairs: true },
              quickSuggestions: true,
              suggestOnTriggerCharacters: true,
              padding: { top: 12, bottom: 12 },
            }}
            theme="customTheme"
          />
        </div>

        <div className="exp-term-footer">
          <div className="exp-term-footer-text">
            $ {language.toUpperCase()} | ESC to close | editable
          </div>
        </div>
      </div>
    </div>
  );
}
