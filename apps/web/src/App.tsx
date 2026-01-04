import React, { useState, useCallback, useRef, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, Terminal, Plus, Activity, Boxes, Database, ShieldCheck, ChevronRight, Command, Play, Pause, Square, Download } from 'lucide-react';
import { Project, LogEntry, JobStatus } from './types';
import Dashboard from './components/Dashboard';
import LiveTerminal from './components/LiveTerminal';
import ProjectWizard from './components/ProjectWizard';
import { SitemapStreamer } from './services/sitemapStreamer';
import { IndexingService } from './services/indexingService';
import { PRISMA_SCHEMA } from './services/prismaSchema';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const NavItem = ({ to, icon: Icon, label }: { to: string; icon: any; label: string }) => {
  const location = useLocation();
  const isActive = location.pathname === to;
  return (
    <Link 
      to={to} 
      className={cn(
        "flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-200 group relative",
        isActive ? "text-white bg-white/10" : "text-zinc-400 hover:text-zinc-100 hover:bg-white/5"
      )}
    >
      <Icon className={cn("w-4 h-4 transition-colors", isActive ? "text-brand-400" : "text-zinc-500 group-hover:text-zinc-300")} />
      <span>{label}</span>
      {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-brand-500 rounded-r-full" />}
    </Link>
  );
};

export default function App() {
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem('indexer_projects');
      return saved ? JSON.parse(saved) : [];
    } catch (e) { return []; }
  });

  useEffect(() => {
    localStorage.setItem('indexer_projects', JSON.stringify(projects));
  }, [projects]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showWizard, setShowWizard] = useState(false);
  const [isJobRunning, setIsJobRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const pauseSignalRef = useRef<{ paused: boolean }>({ paused: false });

  const [chartData, setChartData] = useState<any[]>([
     { name: 'Start', value: 0, secondary: 0 }
  ]);
  
  const logsRef = useRef<LogEntry[]>([]);

  const addLog = useCallback((log: LogEntry) => {
    const newLog = { ...log, timestamp: new Date(log.timestamp) };
    logsRef.current = [...logsRef.current.slice(-999), newLog];
    setLogs(prev => [...prev.slice(-999), newLog]);
  }, []);

  const updateProjectStats = useCallback((projectId: string, statsDelta: Partial<Project['stats']>) => {
    setProjects(prev => prev.map(p => {
      if (p.id === projectId) {
        return {
          ...p,
          stats: {
            totalUrls: p.stats.totalUrls + (statsDelta.totalUrls || 0),
            submitted: p.stats.submitted + (statsDelta.submitted || 0),
            indexed: p.stats.indexed + (statsDelta.indexed || 0),
            errors: p.stats.errors + (statsDelta.errors || 0)
          }
        };
      }
      return p;
    }));
  }, []);

  const appendChartData = (submitted: number, successful: number) => {
      const timeLabel = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });
      setChartData(prev => {
          const last = prev[prev.length - 1];
          return [...prev, { 
              name: timeLabel, 
              value: (last?.value || 0) + submitted,
              secondary: (last?.secondary || 0) + successful
          }].slice(-30);
      });
  };

  const checkPaused = async () => {
    while (pauseSignalRef.current.paused) {
      if (abortControllerRef.current?.signal.aborted) throw new DOMException('Job Aborted', 'AbortError');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  };

  const togglePause = () => {
    if (isPaused) {
      pauseSignalRef.current.paused = false;
      setIsPaused(false);
      addLog({ id: 'resume', timestamp: new Date(), level: 'info', message: '▶ Job Resumed', module: 'WORKER' });
    } else {
      pauseSignalRef.current.paused = true;
      setIsPaused(true);
      addLog({ id: 'pause', timestamp: new Date(), level: 'warn', message: '⏸ Job Paused', module: 'WORKER' });
    }
  };

  const stopJob = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      addLog({ id: 'stop', timestamp: new Date(), level: 'error', message: '🛑 Job Stopped by User', module: 'WORKER' });
      setIsJobRunning(false);
      setIsPaused(false);
      pauseSignalRef.current.paused = false;
    }
  };

  const exportLogs = () => {
    const dataStr = JSON.stringify(logsRef.current, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    const exportFileDefaultName = `indexer-logs-${new Date().toISOString()}.json`;
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const handleStartScan = async (projectId: string, projectOverride?: Project) => {
    if (isJobRunning) return;

    const project = projectOverride || projects.find(p => p.id === projectId);
    if (!project) return;
    
    setIsJobRunning(true);
    setIsPaused(false);
    pauseSignalRef.current.paused = false;
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setLogs([]);
    logsRef.current = [];
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, stats: { totalUrls: 0, submitted: 0, indexed: 0, errors: 0 } } : p));
    setChartData([{ name: 'Start', value: 0, secondary: 0 }]);

    addLog({ id: 'init', timestamp: new Date(), level: 'info', message: `🚀 STARTING JOB: ${project.domain}`, module: 'WORKER' });

    const streamer = new SitemapStreamer(addLog, (count: number) => updateProjectStats(projectId, { totalUrls: count }), signal);
    const indexer = new IndexingService(addLog);
    
    try {
      addLog({ id: `conn`, timestamp: new Date(), level: 'info', message: `Connecting to ${project.sitemapIndexUrl}...`, module: 'STREAM' });
      
      const urls = await streamer.streamParse(project.sitemapIndexUrl);
      
      await checkPaused();

      if (urls.length === 0) {
          throw new Error("No URLs found. Check sitemap accessibility.");
      }

      addLog({ id: 'found', timestamp: new Date(), level: 'success', message: `✔ Discovered ${urls.length} URLs.`, module: 'WORKER' });

      let googleAccessToken = '';
      const hasGoogle = !!(project as any).serviceAccountJson;
      const hasIndexNow = !!project.indexNowKey;

      if (hasGoogle) {
           try {
              googleAccessToken = await indexer.authenticate((project as any).serviceAccountJson);
           } catch (e) {
              addLog({ id: 'auth_fail', timestamp: new Date(), level: 'error', message: `Google Auth Failed: ${(e as Error).message}.`, module: 'API' });
           }
      }

      await checkPaused();

      const allLocs = urls.map(u => u.loc);

      if (hasIndexNow && project.indexNowKey) {
          addLog({ id: 'idx_start', timestamp: new Date(), level: 'info', message: '>>> PHASE A: IndexNow Submission', module: 'API' });
          
          const BATCH_SIZE = 2000;
          let idxSubmitted = 0;
          let idxErrors = 0;

          for (let i = 0; i < allLocs.length; i += BATCH_SIZE) {
              await checkPaused();
              if (signal.aborted) break;

              const batch = allLocs.slice(i, i + BATCH_SIZE);
              const res = await indexer.submitIndexNowBulk(project.domain, project.indexNowKey, batch, signal);
              
              idxSubmitted += res.submitted;
              idxErrors += res.errors;

              updateProjectStats(projectId, { 
                  submitted: batch.length, 
                  indexed: res.submitted, 
                  errors: res.errors 
              });
              appendChartData(allLocs.length, idxSubmitted);
          }
      }

      if (googleAccessToken) {
          addLog({ id: 'goog_start', timestamp: new Date(), level: 'info', message: '>>> PHASE B: Google API', module: 'API' });
          
          const BATCH_SIZE = 10;
          let gSubmitted = 0;
          let gErrors = 0;

          for (let i = 0; i < allLocs.length; i += BATCH_SIZE) {
              await checkPaused();
              if (signal.aborted) break;

              const batch = allLocs.slice(i, i + BATCH_SIZE);
              const res = await indexer.submitGoogleUrls(googleAccessToken, batch, signal);
              
              gSubmitted += res.submitted;
              gErrors += res.errors;

              updateProjectStats(projectId, { 
                  submitted: batch.length, 
                  indexed: res.submitted, 
                  errors: res.errors 
              });
              appendChartData(batch.length, res.submitted);
              
              if (res.abort) {
                  addLog({ id: 'g_abort', timestamp: new Date(), level: 'error', message: 'Google Abort Triggered (Quota/Perms)', module: 'API' });
                  break;
              }
          }
      }

      if (!signal.aborted) {
         addLog({ id: 'done', timestamp: new Date(), level: 'success', message: '✨ JOB COMPLETED.', module: 'WORKER' });
      }

    } catch (e: any) {
      if (e.name === 'AbortError') {
         addLog({ id: 'aborted', timestamp: new Date(), level: 'warn', message: '⚠ Job Aborted by User.', module: 'WORKER' });
      } else {
         addLog({ id: 'err', timestamp: new Date(), level: 'error', message: `FAILURE: ${e.message}`, module: 'WORKER' });
      }
    } finally {
      setIsJobRunning(false);
      setIsPaused(false);
      pauseSignalRef.current.paused = false;
      abortControllerRef.current = null;
    }
  };

  const handleCreateProject = async (data: any) => {
    let serviceAccountJson: any = null;
    let serviceAccountEmail = '';
    
    if (data.gscKey) {
        try {
            const text = await data.gscKey.text();
            serviceAccountJson = JSON.parse(text);
            if (serviceAccountJson.client_email) {
                serviceAccountEmail = serviceAccountJson.client_email;
            }
        } catch (e) { console.error(e); }
    }

    const newId = Math.random().toString(36).substr(2, 9);
    const newProject: any = {
      id: newId,
      name: data.name,
      domain: data.domain,
      sitemapIndexUrl: data.sitemapUrl,
      serviceAccountEmail,
      serviceAccountJson,
      indexNowKey: data.indexNowKey,
      status: 'IDLE' as JobStatus,
      stats: { totalUrls: 0, submitted: 0, indexed: 0, errors: 0 }
    };

    setProjects(prev => [...prev, newProject]);
    setShowWizard(false);
  };

  return (
    <Router>
      <div className="flex h-screen bg-background text-zinc-200 font-sans overflow-hidden">
        <aside className="w-[280px] border-r border-border bg-surface flex flex-col z-20 shadow-2xl">
          <div className="p-6 pb-2">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center shadow-lg shadow-brand-900/50">
                <Boxes className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-base font-bold text-white leading-none">Indexer Pro</h1>
                <span className="text-[10px] font-mono text-emerald-400 bg-emerald-900/30 px-1.5 py-0.5 rounded mt-1 inline-block border border-emerald-500/20">ENTERPRISE</span>
              </div>
            </div>
            
             <div className="relative mb-6">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                 <div className={`w-2 h-2 rounded-full ${isJobRunning ? (isPaused ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500 animate-pulse') : 'bg-zinc-600'}`}></div>
              </div>
              <div className="w-full bg-zinc-900/50 border border-zinc-700 text-xs rounded-lg pl-8 pr-3 py-2 text-zinc-300 font-mono">
                 STATUS: {isJobRunning ? (isPaused ? 'PAUSED' : 'RUNNING') : 'IDLE'}
              </div>
            </div>

            <div className="relative">
              <input 
                type="text" 
                placeholder="Search projects..." 
                className="w-full bg-surfaceHighlight border border-zinc-700 text-sm rounded-lg pl-9 pr-3 py-2 focus:ring-1 focus:ring-brand-500 focus:border-brand-500 outline-none text-zinc-300 placeholder-zinc-500 transition-all"
              />
              <Command className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
            <div className="space-y-1">
              <div className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2">Platform</div>
              <NavItem to="/" icon={LayoutDashboard} label="Dashboard" />
              <NavItem to="/jobs" icon={Terminal} label="Live Operations" />
              <NavItem to="/schema" icon={Database} label="System Config" />
            </div>
            
            <div className="space-y-1">
              <div className="px-3 text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex justify-between items-center">
                <span>Projects</span>
                <span className="bg-zinc-800 text-zinc-400 text-[10px] px-1.5 py-0.5 rounded-full">{projects.length}</span>
              </div>
              {projects.length === 0 && (
                 <div className="px-3 py-4 text-center text-xs text-zinc-600 border border-dashed border-zinc-800 rounded-lg">
                   No projects active.
                 </div>
              )}
              {projects.map(p => (
                <button 
                  key={p.id} 
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-white/5 rounded-md transition-all group"
                >
                  <div className={`w-2 h-2 rounded-full ${isJobRunning ? 'bg-amber-500' : 'bg-zinc-600 group-hover:bg-brand-500'}`} />
                  <span className="truncate">{p.name}</span>
                </button>
              ))}
              
              <button 
                onClick={() => setShowWizard(true)}
                className="w-full flex items-center gap-2 px-3 py-2 mt-2 text-xs font-medium text-zinc-500 hover:text-brand-400 border border-dashed border-zinc-700 hover:border-brand-500/50 rounded-md transition-colors"
              >
                <Plus className="w-3 h-3" /> Add Project
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 flex flex-col relative overflow-hidden bg-background">
           <div className="absolute top-[-20%] right-[-10%] w-[500px] h-[500px] bg-brand-900/10 rounded-full blur-[128px] pointer-events-none" />
          
          <header className="h-16 border-b border-border bg-background/80 backdrop-blur-md flex items-center justify-between px-6 z-10">
            <div className="flex items-center gap-2 text-sm text-zinc-500">
              <span className="hover:text-zinc-300 cursor-pointer">Platform</span>
              <ChevronRight className="w-4 h-4" />
              <span className="text-zinc-200 font-medium">Live Dashboard</span>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-xs font-medium text-emerald-400">System Connected</span>
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
            <div className="max-w-7xl mx-auto space-y-6">
              {projects.length === 0 && !showWizard && (
                <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
                  <div className="w-20 h-20 bg-zinc-800 rounded-3xl flex items-center justify-center mb-4 border border-zinc-700">
                    <Boxes className="w-10 h-10 text-zinc-500" />
                  </div>
                  <h2 className="text-2xl font-bold text-white">No Active Projects</h2>
                  <button 
                    onClick={() => setShowWizard(true)}
                    className="mt-4 px-6 py-3 bg-brand-600 hover:bg-brand-500 text-white rounded-lg font-medium transition-all shadow-lg shadow-brand-500/20"
                  >
                    Setup First Project
                  </button>
                </div>
              )}

              {projects.length > 0 && (
                <Routes>
                  <Route path="/" element={<Dashboard projects={projects} chartData={chartData} />} />
                  <Route path="/jobs" element={
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-[calc(100vh-8rem)]">
                       <div className="xl:col-span-4 flex flex-col gap-4">
                          <div className="bg-surface border border-border rounded-xl p-5 shadow-sm">
                             <h3 className="text-sm font-semibold text-zinc-100 mb-4 flex items-center gap-2">
                               <Terminal className="w-4 h-4 text-brand-400" /> Operation Control
                             </h3>
                             
                             {isJobRunning && (
                               <div className="mb-4 p-3 bg-zinc-900 rounded-lg border border-zinc-800 flex gap-2">
                                  <button onClick={togglePause} className="flex-1 flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 py-2 rounded text-xs font-medium border border-zinc-700 transition-colors">
                                    {isPaused ? <Play className="w-3 h-3 text-emerald-400" /> : <Pause className="w-3 h-3 text-amber-400" />}
                                    {isPaused ? "Resume" : "Pause"}
                                  </button>
                                  <button onClick={stopJob} className="flex-1 flex items-center justify-center gap-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 py-2 rounded text-xs font-medium border border-red-900/30 transition-colors">
                                    <Square className="w-3 h-3 fill-current" />
                                    Stop
                                  </button>
                               </div>
                             )}

                             <div className="space-y-3">
                               {projects.map(p => (
                                 <div key={p.id} className="group p-3 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg flex justify-between items-center transition-all">
                                   <div className="overflow-hidden mr-3">
                                     <div className="font-medium text-zinc-200 text-sm group-hover:text-brand-300 transition-colors truncate">{p.name}</div>
                                     <div className="text-[11px] text-zinc-500 mt-1 flex items-center gap-1">
                                       <Activity className="w-3 h-3" /> {p.stats.totalUrls} URLs
                                     </div>
                                   </div>
                                   <button 
                                     onClick={() => handleStartScan(p.id)}
                                     disabled={isJobRunning}
                                     className={cn(
                                       "px-3 py-1.5 rounded text-xs font-medium transition-all shadow-lg shrink-0 flex items-center gap-1",
                                       isJobRunning 
                                        ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-transparent" 
                                        : "bg-zinc-100 text-zinc-900 hover:bg-white hover:scale-105"
                                     )}
                                   >
                                     <Play className="w-3 h-3 fill-current" />
                                     Run
                                   </button>
                                 </div>
                               ))}
                             </div>
                             
                             <div className="mt-4 pt-4 border-t border-zinc-800">
                               <button onClick={exportLogs} className="w-full flex items-center justify-center gap-2 text-xs text-zinc-400 hover:text-white transition-colors p-2 hover:bg-zinc-800 rounded">
                                 <Download className="w-3 h-3" /> Download Logs (JSON)
                               </button>
                             </div>
                          </div>
                          
                          <div className="bg-surface border border-border rounded-xl p-5 flex-1 shadow-sm">
                            <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Pipeline Status</h4>
                            <div className="space-y-3">
                              {['Proxy Rotation Layer', 'Stream Parser', 'Dedup Engine', 'API Gateway'].map((q) => (
                                <div key={q} className="flex items-center justify-between text-xs p-2 rounded bg-zinc-900 border border-zinc-800/50">
                                  <span className="font-mono text-zinc-400">{q}</span>
                                  <span className={cn(
                                    "px-1.5 py-0.5 rounded flex items-center gap-1", 
                                    isJobRunning && !isPaused
                                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                                      : isPaused ? "bg-amber-500/10 text-amber-400" : "bg-zinc-800 text-zinc-500"
                                  )}>
                                    <div className={cn("w-1.5 h-1.5 rounded-full", isJobRunning && !isPaused ? "bg-emerald-500 animate-pulse" : isPaused ? "bg-amber-500" : "bg-zinc-500")} />
                                    {isJobRunning ? (isPaused ? 'PAUSED' : 'ACTIVE') : 'IDLE'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                       </div>
                       <div className="xl:col-span-8 h-full">
                          <LiveTerminal logs={logs} isRunning={isJobRunning} />
                       </div>
                    </div>
                  } />
                  <Route path="/schema" element={
                    <div className="h-full flex flex-col">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-semibold text-zinc-100">Database Schema</h3>
                      </div>
                      <div className="flex-1 bg-[#0d1117] border border-zinc-800 rounded-xl overflow-hidden shadow-2xl flex flex-col">
                        <pre className="p-4 font-mono text-xs text-zinc-300 overflow-auto flex-1 custom-scrollbar leading-relaxed">
                          {PRISMA_SCHEMA}
                        </pre>
                      </div>
                    </div>
                  } />
                </Routes>
              )}
            </div>
          </div>
        </main>

        {showWizard && (
          <ProjectWizard 
            onCancel={() => setShowWizard(false)} 
            onSubmit={handleCreateProject} 
          />
        )}
      </div>
    </Router>
  );
}