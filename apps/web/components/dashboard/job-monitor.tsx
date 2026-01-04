'use client';

import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  PlayIcon, 
  PauseIcon, 
  RotateCwIcon,
  CheckCircle2Icon,
  XCircleIcon,
  LoaderIcon 
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useWebSocket } from '@/hooks/use-websocket';

interface JobMonitorProps {
  projectId: string;
}

interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
  module: string;
}

export function JobMonitor({ projectId }: JobMonitorProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  
  const utils = trpc.useUtils();
  
  // Get active jobs
  const { data: activeJobs, isLoading } = trpc.jobs.getActive.useQuery(
    { projectId },
    { refetchInterval: 5000 }
  );
  
  // WebSocket for real-time logs
  const { sendMessage, lastMessage, readyState } = useWebSocket(
    `${process.env.NEXT_PUBLIC_WS_URL}/jobs/${projectId}`,
    {
      onOpen: () => setIsConnected(true),
      onClose: () => setIsConnected(false),
    }
  );
  
  // Handle incoming WebSocket messages
  useEffect(() => {
    if (lastMessage) {
      try {
        const data = JSON.parse(lastMessage.data);
        
        if (data.type === 'LOG') {
          setLogs(prev => [...prev.slice(-199), data.payload]);
        } else if (data.type === 'JOB_UPDATE') {
          utils.jobs.getActive.invalidate({ projectId });
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message', e);
      }
    }
  }, [lastMessage, projectId, utils]);
  
  // Trigger scan mutation
  const triggerScan = trpc.projects.triggerScan.useMutation({
    onSuccess: () => {
      utils.jobs.getActive.invalidate({ projectId });
    },
  });
  
  const handleStartScan = () => {
    triggerScan.mutate({ projectId, type: 'FULL_SCAN' });
  };
  
  const currentJob = activeJobs?.[0];
  
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {/* Job Control Panel */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Job Control</span>
            <Badge variant={isConnected ? 'default' : 'secondary'}>
              {isConnected ? 'Connected' : 'Disconnected'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Current Job Status */}
          {currentJob ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{currentJob.type}</span>
                <JobStatusBadge status={currentJob.status} />
              </div>
              
              <Progress value={currentJob.progress} className="h-2" />
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{currentJob.processedItems} / {currentJob.totalItems} items</span>
                <span>{currentJob.progress}%</span>
              </div>
              
              {currentJob.status === 'PROCESSING' && (
                <Button variant="outline" size="sm" className="w-full">
                  <PauseIcon className="h-4 w-4 mr-2" />
                  Pause
                </Button>
              )}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground mb-4">No active jobs</p>
              <Button 
                onClick={handleStartScan}
                disabled={triggerScan.isPending}
                className="w-full"
              >
                {triggerScan.isPending ? (
                  <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <PlayIcon className="h-4 w-4 mr-2" />
                )}
                Start Full Scan
              </Button>
            </div>
          )}
          
          {/* Queue Status */}
          <div className="pt-4 border-t space-y-2">
            <h4 className="text-sm font-medium">Queue Status</h4>
            <div className="space-y-1 text-xs font-mono">
              <QueueStatusRow name="sitemap-scanner" status="idle" count={0} />
              <QueueStatusRow name="google-submitter" status="processing" count={240} />
              <QueueStatusRow name="indexnow-submitter" status="idle" count={0} />
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Live Terminal */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              Worker Output
              {currentJob?.status === 'PROCESSING' && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </span>
              )}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setLogs([])}>
              <RotateCwIcon className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px] rounded-md bg-black/90 p-4 font-mono text-xs">
            {logs.length === 0 ? (
              <p className="text-slate-600 italic">Waiting for job to start...</p>
            ) : (
              logs.map((log) => (
                <LogLine key={log.id} log={log} />
              ))
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

function JobStatusBadge({ status }: { status: string }) {
  const variants: Record<string, { variant: any; icon: any }> = {
    PENDING: { variant: 'secondary', icon: LoaderIcon },
    PROCESSING: { variant: 'default', icon: LoaderIcon },
    COMPLETED: { variant: 'success', icon: CheckCircle2Icon },
    FAILED: { variant: 'destructive', icon: XCircleIcon },
  };
  
  const { variant, icon: Icon } = variants[status] ?? variants.PENDING;
  
  return (
    <Badge variant={variant} className="gap-1">
      <Icon className={cn('h-3 w-3', status === 'PROCESSING' && 'animate-spin')} />
      {status}
    </Badge>
  );
}

function QueueStatusRow({ name, status, count }: { name: string; status: string; count: number }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted-foreground">{name}</span>
      <span className={cn(
        status === 'processing' ? 'text-yellow-500' : 'text-green-500'
      )}>
        {status === 'processing' ? `Processing (${count})` : 'Idle'}
      </span>
    </div>
  );
}

const LogLine: React.FC<{ log: LogEntry }> = ({ log }) => {
  const levelColors: Record<string, string> = {
    info: 'text-blue-400',
    warn: 'text-yellow-400',
    error: 'text-red-500',
    success: 'text-green-400',
  };
  
  const moduleColors: Record<string, string> = {
    STREAM: 'text-purple-400',
    DB: 'text-cyan-400',
    WORKER: 'text-orange-400',
    API: 'text-pink-400',
  };
  
  const levelIcons: Record<string, string> = {
    info: 'ℹ',
    warn: '⚠',
    error: '✖',
    success: '✔',
  };
  
  return (
    <div className="flex gap-3 leading-relaxed hover:bg-white/5 px-1 -mx-1 rounded">
      <span className="text-slate-500 shrink-0">
        [{new Date(log.timestamp).toLocaleTimeString()}]
      </span>
      <span className={cn('font-bold shrink-0 w-16', moduleColors[log.module])}>
        {log.module}
      </span>
      <span className={cn(levelColors[log.level])}>
        {levelIcons[log.level]} {log.message}
      </span>
    </div>
  );
}