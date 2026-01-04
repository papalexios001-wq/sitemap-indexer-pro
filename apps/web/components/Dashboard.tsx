import React from 'react';
import { Project, ChartDataPoint } from '../types';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';

interface DashboardProps {
  projects: Project[];
  chartData: ChartDataPoint[];
}

const Dashboard: React.FC<DashboardProps> = ({ projects, chartData }) => {
  const totalUrls = projects.reduce((acc, p) => acc + p.stats.totalUrls, 0);
  const totalIndexed = projects.reduce((acc, p) => acc + p.stats.indexed, 0);
  const indexRate = totalUrls > 0 ? ((totalIndexed / totalUrls) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6">
      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Total URLs Tracked" value={totalUrls.toLocaleString()} trend="+12%" good={true} />
        <StatCard title="Indexed Pages" value={totalIndexed.toLocaleString()} trend="+5%" good={true} />
        <StatCard title="Indexing Rate" value={`${indexRate}%`} trend="+1.2%" good={true} />
        <StatCard title="Crawl Errors" value="42" trend="-3" good={true} isError={true} />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[400px]">
        {/* Main Chart */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-medium text-slate-200 mb-6">Submission vs. Indexing Velocity</h3>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorSec" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
              <XAxis dataKey="name" stroke="#64748b" tick={{fill: '#64748b'}} />
              <YAxis stroke="#64748b" tick={{fill: '#64748b'}} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} 
                itemStyle={{ color: '#e2e8f0' }}
              />
              <Area type="monotone" dataKey="value" stroke="#0ea5e9" fillOpacity={1} fill="url(#colorVal)" strokeWidth={2} name="Submitted" />
              <Area type="monotone" dataKey="secondary" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorSec)" strokeWidth={2} name="Indexed" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Mini Chart / Project Health */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm flex flex-col">
          <h3 className="text-lg font-medium text-slate-200 mb-4">Project Health Score</h3>
           <div className="flex-1">
             <ResponsiveContainer width="100%" height="100%">
               <BarChart data={projects.map(p => ({ name: p.name.split(' ')[0], health: p.stats.indexed / p.stats.totalUrls * 100 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="name" stroke="#64748b" />
                  <Tooltip cursor={{fill: '#1e293b'}} contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b' }} />
                  <Bar dataKey="health" fill="#22c55e" radius={[4, 4, 0, 0]} name="Health Score" />
               </BarChart>
             </ResponsiveContainer>
           </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, trend, good, isError = false }: any) => (
  <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl hover:border-slate-700 transition-colors">
    <div className="flex justify-between items-start mb-4">
      <h3 className="text-sm font-medium text-slate-400">{title}</h3>
      <span className={`text-xs px-2 py-1 rounded-full ${good ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
        {trend}
      </span>
    </div>
    <div className={`text-3xl font-bold ${isError ? 'text-red-400' : 'text-white'}`}>{value}</div>
  </div>
);

export default Dashboard;