import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { clsx } from 'clsx';
import { TerminalSquare, Pause, AlertCircle } from 'lucide-react';

interface LiveTerminalProps {
  logs: LogEntry[];
  isRunning: boolean;
}

const LiveTerminal: React.FC<LiveTerminalProps> = ({ logs, isRunning }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom whenever logs change
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-[#0d1117] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl font-mono text-sm relative group">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <TerminalSquare className="w-4 h-4 text-zinc-500" />
          <span className="text-zinc-400 text-xs font-semibold tracking-wide">WORKER_OUTPUT_STREAM</span>
        </div>
        <div className="flex items-center gap-3">
           <div className="text-[10px] text-zinc-600 font-medium">bash — 80x24</div>
           {isRunning ? (
            <div className="flex items-center gap-2 px-2 py-1 bg-green-500/10 rounded border border-green-500/20">
               <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
              </span>
              <span className="text-green-400 text-[10px] font-bold tracking-wider">LIVE</span>
            </div>
           ) : (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-zinc-800 rounded">
               <div className="w-2 h-2 rounded-full bg-zinc-600"></div>
               <span className="text-zinc-500 text-[10px] font-bold tracking-wider">OFFLINE</span>
            </div>
           )}
        </div>
      </div>

      {/* Terminal Body */}
      <div 
        className="flex-1 p-4 overflow-y-auto terminal-scroll space-y-1.5 bg-[#0d1117] relative scroll-smooth"
      >
        {/* Scanline FX */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] z-10 pointer-events-none bg-[length:100%_4px,3px_100%] opacity-20"></div>

        {logs.length === 0 && !isRunning && (
          <div className="text-zinc-600 italic mt-12 opacity-50 flex flex-col items-center justify-center gap-2">
             <Pause className="w-8 h-8 opacity-20" />
             <span>System Ready. Initialize job to view logs.</span>
          </div>
        )}

        {logs.length === 0 && isRunning && (
           <div className="flex items-center gap-2 text-zinc-500 italic mt-4 animate-pulse px-2">
             <div className="w-2 h-2 bg-zinc-500 rounded-full"></div>
             Initializing Worker Process...
           </div>
        )}
        
        {logs.map((log) => (
          <div key={log.id} className="flex gap-3 font-mono text-[13px] leading-relaxed opacity-90 hover:opacity-100 hover:bg-white/5 px-2 -mx-2 rounded transition-all">
            <span className="text-zinc-600 shrink-0 select-none w-20 text-right">
              {log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}
            </span>
            <div className="flex-1 break-all flex gap-3">
               <span className={clsx(
                 "font-bold shrink-0 w-16 text-center text-[10px] py-0.5 rounded px-1 self-start mt-0.5",
                 log.module === 'STREAM' && "bg-purple-500/10 text-purple-400",
                 log.module === 'DB' && "bg-cyan-500/10 text-cyan-400",
                 log.module === 'WORKER' && "bg-orange-500/10 text-orange-400",
                 log.module === 'API' && "bg-pink-500/10 text-pink-400",
               )}>
                 {log.module}
               </span>
               <span className={clsx("flex-1", getLevelColor(log.level))}>
                 {log.message}
               </span>
            </div>
          </div>
        ))}
        {/* Invisible element to scroll to */}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};

const getLevelColor = (level: LogEntry['level']) => {
  switch (level) {
    case 'info': return 'text-zinc-300';
    case 'warn': return 'text-amber-300';
    case 'error': return 'text-red-400 font-bold bg-red-500/10 px-1 rounded inline-block';
    case 'success': return 'text-emerald-400 font-medium';
    default: return 'text-zinc-400';
  }
};

export default LiveTerminal;