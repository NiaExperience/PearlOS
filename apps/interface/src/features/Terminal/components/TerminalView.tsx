'use client';
// Feature: Terminal
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal as TerminalIcon } from 'lucide-react';
import { usePostHog } from 'posthog-js/react';

interface TerminalLine {
  type: 'command' | 'output' | 'error';
  content: string;
  timestamp: string;
}

const HOME = '~';

// Use empty string for timestamps to avoid hydration mismatch (server vs client Date differs).
// The timestamp is never displayed in the UI, so this is safe.
const initialLines: TerminalLine[] = [
  { type: 'output', content: 'Welcome to NIA Terminal', timestamp: '' },
  { type: 'output', content: 'Connected to shell. Type "help" for built-in commands.', timestamp: '' },
];

const HELP_TEXT = [
  'Available commands (built-in):',
  '  help    — show this message',
  '  clear   — clear the terminal',
  '  Ctrl+L  — clear screen',
  '  Ctrl+C  — cancel current input',
  '',
  'All other commands are executed in a real shell.',
  'Examples: ls, pwd, echo hello, cat file.txt, python3 script.py',
];

const TerminalView: React.FC = () => {
  const posthog = usePostHog();
  const [lines, setLines] = useState<TerminalLine[]>(initialLines);
  const [currentInput, setCurrentInput] = useState('');
  const [currentDirectory, setCurrentDirectory] = useState(HOME);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom whenever lines update
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
    // Fetch initial working directory
    fetch('/api/terminal/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'pwd', cwd: undefined }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.cwd) setCurrentDirectory(data.cwd.trim());
        else if (data.stdout) setCurrentDirectory(data.stdout.trim());
      })
      .catch(() => {/* ignore - keep default */});
  }, []);

  const addLine = useCallback((type: 'output' | 'error', content: string) => {
    setLines((prev) => [...prev, { type, content, timestamp: new Date().toISOString() }]);
  }, []);

  const addLines = useCallback((type: 'output' | 'error', text: string) => {
    if (!text) return;
    const splitLines = text.split('\n');
    // Remove trailing empty line from command output
    if (splitLines[splitLines.length - 1] === '') splitLines.pop();
    splitLines.forEach((line) => addLine(type, line));
  }, [addLine]);

  const executeCommand = useCallback(async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;

    posthog?.capture('terminal_command_executed', { command: trimmed.split(' ')[0] });
    setCommandHistory((prev) => [...prev, trimmed]);
    setHistoryIndex(-1);
    setCurrentInput('');

    // Show the command in the terminal
    setLines((prev) => [
      ...prev,
      { type: 'command', content: `${currentDirectory} $ ${trimmed}`, timestamp: new Date().toISOString() },
    ]);

    // Handle client-side built-ins
    if (trimmed === 'clear') {
      setLines([]);
      return;
    }
    if (trimmed === 'help') {
      HELP_TEXT.forEach((l) => addLine('output', l));
      return;
    }

    // Execute via API
    setIsLoading(true);
    try {
      const response = await fetch('/api/terminal/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: trimmed, cwd: currentDirectory }),
      });

      if (!response.ok) {
        addLine('error', `Error: server returned ${response.status}`);
        return;
      }

      const data = await response.json();

      // Update working directory if it changed (e.g. after cd)
      if (data.cwd && data.cwd !== currentDirectory) {
        setCurrentDirectory(data.cwd);
      }

      if (data.stdout) addLines('output', data.stdout);
      if (data.stderr) addLines('error', data.stderr);

      // Show nothing for empty successful commands (like cd)
      if (!data.stdout && !data.stderr && data.exitCode === 0 && trimmed.startsWith('cd ')) {
        // cwd already updated above
      }
    } catch (err) {
      addLine('error', `Network error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, [addLine, addLines, currentDirectory, posthog]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      if (!isLoading) executeCommand(currentInput);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length > 0) {
        const ni = historyIndex + 1;
        if (ni < commandHistory.length) {
          setHistoryIndex(ni);
          setCurrentInput(commandHistory[commandHistory.length - 1 - ni]);
        }
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const ni = historyIndex - 1;
        setHistoryIndex(ni);
        setCurrentInput(commandHistory[commandHistory.length - 1 - ni]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setCurrentInput('');
      }
    } else if (e.key === 'c' && e.ctrlKey) {
      // Ctrl+C — cancel current input
      if (isLoading) {
        // Can't cancel fetch easily, but at least clear UI state
        setIsLoading(false);
        addLine('output', '^C');
      } else {
        addLine('output', `${currentDirectory} $ ${currentInput}^C`);
        setCurrentInput('');
      }
    } else if (e.key === 'l' && e.ctrlKey) {
      // Ctrl+L — clear screen
      e.preventDefault();
      setLines([]);
    }
  }, [commandHistory, currentDirectory, currentInput, executeCommand, historyIndex, isLoading, addLine]);

  return (
    <div
      className="w-full h-full bg-black text-green-400 font-mono text-sm flex flex-col"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 p-2 bg-zinc-900 border-b border-zinc-700 shrink-0">
        <TerminalIcon className="w-4 h-4" />
        <span>Terminal</span>
        <span className="text-xs text-zinc-500 ml-auto">{currentDirectory}</span>
      </div>

      {/* Output area */}
      <div ref={terminalRef} className="flex-1 overflow-y-auto p-3 space-y-0.5 bg-zinc-950">
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.type === 'error'
                ? 'text-red-400 whitespace-pre-wrap'
                : l.type === 'command'
                ? 'text-white whitespace-pre-wrap'
                : 'text-green-400 whitespace-pre-wrap'
            }
          >
            {l.content}
          </div>
        ))}
        {isLoading && (
          <div className="text-zinc-500 animate-pulse">▊</div>
        )}
      </div>

      {/* Input area */}
      <div className="p-2 bg-zinc-900 border-t border-zinc-700 flex items-center gap-2 shrink-0">
        <span className="text-green-500 shrink-0">
          {currentDirectory} $
        </span>
        <input
          ref={inputRef}
          value={currentInput}
          onChange={(e) => setCurrentInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-green-400 min-w-0"
          autoComplete="off"
          spellCheck={false}
          disabled={isLoading}
          placeholder={isLoading ? 'Running...' : ''}
        />
      </div>
    </div>
  );
};

export default TerminalView;
