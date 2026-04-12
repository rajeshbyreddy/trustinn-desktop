'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Maximize2, Play, Wrench } from 'lucide-react';

// Use this for the actual editing logic
import Editor from 'react-simple-code-editor';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/cjs/styles/prism';

const ExpandedEditorModal = dynamic(
  () => import('@/components/ExpandedEditorModal'),
  { ssr: false }
);

interface CodeEditorProps {
  code: string;
  language: string;
  onCodeChange: (code: string) => void;
  onExecute: () => void;
  onStop?: () => void;
  isExecuting: boolean;
  toolSelected: boolean;
  onCompile?: () => void;
  isCompiling?: boolean;
}

export default function CodeEditor({
  code,
  language,
  onCodeChange,
  onExecute,
  onStop,
  isExecuting,
  toolSelected,
  onCompile,
  isCompiling = false,
}: CodeEditorProps) {
  const [showExpandedEditor, setShowExpandedEditor] = useState(false);

  const languageLabel = useMemo(() => language.toUpperCase(), [language]);

  // Highlighting function used by the Editor component
  const highlightCode = (input: string) => (
    <SyntaxHighlighter
      language={language}
      style={oneLight}
      customStyle={{
        margin: 0,
        padding: 0,
        background: 'transparent',
        fontSize: 'inherit',
        fontFamily: 'inherit',
      }}
    >
      {input || ' '}
    </SyntaxHighlighter>
  );

  return (
    <>
      <div className="flex flex-col gap-3">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 text-[11px] font-bold text-slate-700 tracking-wide">
            <span className="px-2 py-1 rounded-full bg-slate-200 text-slate-800">
              {languageLabel}
            </span>
            <span>Write Code</span>
          </div>

          <button
            onClick={() => setShowExpandedEditor(true)}
            className="flex items-center gap-1 border border-slate-300 bg-white text-slate-700 rounded-lg px-3 py-1.5 text-[11px] font-bold hover:bg-slate-50 transition-colors"
          >
            <Maximize2 size={14} />
            Expand
          </button>
        </div>

        {/* Warning */}
        {!toolSelected && (
          <div className="flex items-center gap-2 bg-orange-50 border border-orange-200 text-orange-800 rounded-lg px-3 py-2 text-[11px] font-semibold animate-in fade-in slide-in-from-top-1">
            <Wrench size={14} />
            Select a tool in Tool Configuration before running.
          </div>
        )}

        {/* Editor Container */}
        <div className="relative border border-slate-300 rounded-xl bg-white h-[280px] overflow-auto scrollbar-thin scrollbar-thumb-slate-300">
          <Editor
            value={code}
            onValueChange={(code) => onCodeChange(code)}
            highlight={(code) => highlightCode(code)}
            padding={16}
            style={{
              fontFamily: '"Fira code", "Fira Mono", monospace',
              fontSize: 13,
              minHeight: '100%',
              outline: 'none',
            }}
            className="min-h-full"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-2">
          {/* Run */}
          {/* <button
            onClick={onExecute}
            disabled={isExecuting || isCompiling}
            className={`flex items-center gap-1 rounded-lg px-4 py-2 text-[11px] font-bold text-white transition-all
              ${
                isExecuting || isCompiling
                  ? 'bg-blue-300 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 active:scale-95'
              }
            `}
          >
            <Play size={14} fill="currentColor" />
            {isExecuting ? 'Running...' : 'Run'}
          </button> */}

          {/* Compile */}
          <button
            onClick={() => onCompile?.()}
            disabled={isExecuting || isCompiling || !onCompile}
            className={`rounded-lg px-4 py-2 text-[11px] font-bold border transition-all
              ${
                isExecuting || isCompiling || !onCompile
                  ? 'border-orange-200 bg-orange-50 text-orange-300 cursor-not-allowed'
                  : 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100 active:scale-95'
              }
            `}
          >
            {isCompiling ? 'Compiling...' : 'Compile'}
          </button>

          {/* Stop */}
          <button
            onClick={() => onStop?.()}
            disabled={!onStop || (!isExecuting && !isCompiling)}
            className={`rounded-lg px-4 py-2 text-[11px] font-bold border ml-auto transition-all
              ${
                !onStop || (!isExecuting && !isCompiling)
                  ? 'border-red-100 bg-red-50 text-red-200 cursor-not-allowed'
                  : 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100 active:scale-95'
              }
            `}
          >
            Stop
          </button>
        </div>
      </div>

      <ExpandedEditorModal
        isOpen={showExpandedEditor}
        onClose={() => setShowExpandedEditor(false)}
        code={code}
        onCodeChange={onCodeChange}
        language={language}
      />
    </>
  );
}