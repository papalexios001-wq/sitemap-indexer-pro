import React from 'react';
import { Project, ChartDataPoint } from '../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from 'recharts';
import { ArrowUpRight, ArrowDownRight, Globe, Layers, CheckCircle2, AlertOctagon, Activity } from 'lucide-react';
import { clsx } from 'clsx';

interface DashboardProps {
  projects: Project[];
  chartData: ChartDataPoint[];
}

const Dashboard: React.FC<DashboardProps> = ({ projects, chartData }) => {
  const totalUrls = projects.reduce((acc, p) => acc + p.stats.totalUrls, 0);
  const totalIndexed = projects.reduce((acc, p) => acc + p.stats.indexed, 0);
  const indexRate = totalUrls > 0 ? ((totalIndexed / totalUrls) * 100).toFixed(1) : '0';
  const hasData = totalUrls > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Total URLs" 
          value={totalUrls.toLocaleString()} 
          trend={hasData ? "+12.5%" : "0%"}
          icon={Globe}
          color="blue"
        />
        <StatCard 
          title="Indexed Pages" 
          value={totalIndexed.toLocaleString()} 
          trend={hasData ? "+5.2%" : "0%"} 
          icon={Layers}
          color="purple"
        />
        <StatCard 
          title="Indexing Rate" 
          value={`${indexRate}%`} 
          trend={hasData ? "+1.2%" : "0%"} 
          icon={CheckCircle2}
          color="emerald"
        />
        <StatCard 
          title="Crawl Errors" 
          value={projects.reduce((acc, p) => acc + p.stats.errors, 0).toString()} 
          trend={hasData ? "-3.1%" : "0%"} 
          icon={AlertOctagon}
          color="red"
          isInverse
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Chart */}
        <div className="lg:col-span-2 glass-panel rounded-xl p-6 shadow-sm flex flex-col h-[400px]">
          <div className="flex justify-between items-center mb-6">
             <div>
               <h3 className="text-sm font-semibold text-zinc-100">Indexing Performance</h3>
               <p className="text-xs text-zinc-500 mt-1">Real-time submission vs indexing velocity</p>
             </div>
             <div className="flex gap-2">
               <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                 <div className="w-2 h-2 rounded-full bg-brand-500"></div> Submitted
               </div>
               <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                 <div className="w-2 h-2 rounded-full bg-purple-500"></div> Indexed
               </div>
             </div>
          </div>
          <div className="flex-1 w-full min-h-0 relative">
            {!hasData && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/50 backdrop-blur-sm">
                <Activity className="w-8 h-8 text-zinc-600 mb-2" />
                <span className="text-xs text-zinc-500">Waiting for data...</span>
              </div>
            )}
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorSec" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis 
                  dataKey="name" 
                  stroke="#52525b" 
                  tick={{fill: '#71717a', fontSize: 11}} 
                  tickLine={false}
                  axisLine={false}
                  dy={10}
                />
                <YAxis 
                  stroke="#52525b" 
                  tick={{fill: '#71717a', fontSize: 11}} 
                  tickLine={false}
                  axisLine={false}
                  dx={-10}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} 
                  itemStyle={{ color: '#e4e4e7', fontSize: '12px' }}
                  cursor={{ stroke: '#3f3f46', strokeWidth: 1 }}
                />
                <Area type="monotone" dataKey="value" stroke="#0ea5e9" fillOpacity={1} fill="url(#colorVal)" strokeWidth={2} activeDot={{ r: 4, strokeWidth: 0 }} />
                <Area type="monotone" dataKey="secondary" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorSec)" strokeWidth={2} activeDot={{ r: 4, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Project Health */}
        <div className="glass-panel rounded-xl p-6 shadow-sm flex flex-col h-[400px]">
          <h3 className="text-sm font-semibold text-zinc-100 mb-2">Health Distribution</h3>
          <p className="text-xs text-zinc-500 mb-6">Indexing success rate by project</p>
           <div className="flex-1 w-full min-h-0 relative">
             {!hasData && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-background/50 backdrop-blur-sm">
                 <span className="text-xs text-zinc-500">No active projects</span>
              </div>
             )}
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={projects.map(p => ({ name: p.name.split(' ')[0], health: p.stats.totalUrls > 0 ? Math.floor(p.stats.indexed / p.stats.totalUrls * 100) : 0 }))} barSize={40}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                  <XAxis dataKey="name" stroke="#52525b" tick={{fill: '#71717a', fontSize: 11}} axisLine={false} tickLine={false} />
                  <Tooltip 
                    cursor={{fill: '#27272a', opacity: 0.4}} 
                    contentStyle={{ backgroundColor: '#18181b', borderColor: '#27272a', borderRadius: '8px' }}
                    itemStyle={{ color: '#e4e4e7', fontSize: '12px' }}
                  />
                  <Bar dataKey="health" radius={[4, 4, 0, 0]}>
                    {projects.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={index % 2 === 0 ? '#10b981' : '#059669'} />
                    ))}
                  </Bar>
               </BarChart>
             </ResponsiveContainer>
           </div>
           <div className="mt-4 pt-4 border-t border-zinc-800">
             <div className="flex justify-between items-center text-xs">
               <span className="text-zinc-400">System Status</span>
               <span className={clsx("font-medium", hasData ? "text-emerald-400" : "text-zinc-500")}>
                 {hasData ? "Operational" : "Standby"}
               </span>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, trend, icon: Icon, color, isInverse }: any) => {
  const isPositive = trend.startsWith('+');
  const isNeutral = trend === "0%";
  
  const trendColor = isNeutral 
    ? 'text-zinc-500'
    : isInverse 
      ? (isPositive ? 'text-red-400' : 'text-emerald-400')
      : (isPositive ? 'text-emerald-400' : 'text-red-400');
  
  const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;

  const bgColors: any = {
    blue: 'bg-brand-500/10 text-brand-500',
    purple: 'bg-purple-500/10 text-purple-500',
    emerald: 'bg-emerald-500/10 text-emerald-500',
    red: 'bg-red-500/10 text-red-500',
  };

  return (
    <div className="bg-surface border border-border p-5 rounded-xl hover:border-zinc-700 transition-all duration-300 hover:shadow-lg group">
      <div className="flex justify-between items-start mb-4">
        <div className={clsx("p-2 rounded-lg", bgColors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        {!isNeutral && (
          <div className={clsx("flex items-center text-xs font-medium px-2 py-1 rounded-full bg-zinc-900 border border-zinc-800", trendColor)}>
            <TrendIcon className="w-3 h-3 mr-1" />
            {trend}
          </div>
        )}
      </div>
      <div>
        <h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-1">{title}</h3>
        <div className="text-2xl font-bold text-zinc-100">{value}</div>
      </div>
    </div>
  );
};

export default Dashboard;