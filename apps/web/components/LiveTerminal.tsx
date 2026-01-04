import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LiveTerminalProps {
  logs: LogEntry[];
  isRunning: boolean;
}

const LiveTerminal: React.FC<LiveTerminalProps> = ({ logs, isRunning }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const getLevelColor = (level: LogEntry['level']) => {
    switch (level) {
      case 'info': return 'text-blue-400';
      case 'warn': return 'text-yellow-400';
      case 'error': return 'text-red-500';
      case 'success': return 'text-green-400';
      default: return 'text-gray-300';
    }
  };

  return (
    <div className="flex flex-col h-full bg-dark-900 border border-slate-700 rounded-lg overflow-hidden shadow-2xl font-mono text-sm">
      <div className="flex items-center justify-between px-4 py-2 bg-slate-800 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="ml-2 text-slate-400 text-xs font-semibold">WORKER_OUTPUT_STREAM</span>
        </div>
        {isRunning && (
          <div className="flex items-center gap-2">
             <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
            </span>
            <span className="text-green-400 text-xs">LIVE</span>
          </div>
        )}
      </div>
      <div 
        ref={scrollRef}
        className="flex-1 p-4 overflow-y-auto terminal-scroll space-y-1 bg-black/90"
      >
        {logs.length === 0 && (
          <div className="text-slate-600 italic">Waiting for job to start...</div>
        )}
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 font-mono leading-relaxed opacity-90 hover:opacity-100 transition-opacity">
            <span className="text-slate-500 shrink-0 select-none">
              [{log.timestamp.toLocaleTimeString()}]
            </span>
            <span className={`font-bold shrink-0 w-16 ${log.module === 'STREAM' ? 'text-purple-400' : log.module === 'DB' ? 'text-cyan-400' : 'text-orange-400'}`}>
              {log.module}
            </span>
            <span className={`${getLevelColor(log.level)} break-all`}>
              {levelPrefix(log.level)} {log.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

function levelPrefix(level: LogEntry['level']) {
  switch (level) {
    case 'info': return 'ℹ';
    case 'warn': return '⚠';
    case 'error': return '✖';
    case 'success': return '✔';
  }
}

export default LiveTerminal;