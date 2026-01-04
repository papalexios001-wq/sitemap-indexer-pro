'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  ArrowUpIcon, 
  ArrowDownIcon, 
  GlobeIcon, 
  CheckCircleIcon,
  ClockIcon,
  AlertTriangleIcon 
} from 'lucide-react';
import { trpc } from '@/lib/trpc/client';
import { cn, formatNumber, formatPercentage } from '@/lib/utils';

interface StatsOverviewProps {
  projectId?: string;
}

export function StatsOverview({ projectId }: StatsOverviewProps) {
  const { data: projects, isLoading } = trpc.projects.list.useQuery(undefined, {
    enabled: !projectId,
  });
  
  const { data: project } = trpc.projects.getById.useQuery(
    { id: projectId! },
    { enabled: !!projectId }
  );
  
  // Aggregate stats
  const stats = projectId && project 
    ? {
        totalUrls: project.totalUrls,
        indexedUrls: project.indexedUrls,
        pendingUrls: project.pendingUrls,
        errorUrls: project.errorUrls,
      }
    : projects?.reduce(
        (acc, p) => ({
          totalUrls: acc.totalUrls + p.totalUrls,
          indexedUrls: acc.indexedUrls + p.indexedUrls,
          pendingUrls: acc.pendingUrls + p.pendingUrls,
          errorUrls: acc.errorUrls + p.errorUrls,
        }),
        { totalUrls: 0, indexedUrls: 0, pendingUrls: 0, errorUrls: 0 }
      );
  
  const indexingRate = stats && stats.totalUrls > 0 
    ? (stats.indexedUrls / stats.totalUrls) * 100 
    : 0;
  
  if (isLoading) {
    return <StatsOverviewSkeleton />;
  }
  
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="Total URLs"
        value={formatNumber(stats?.totalUrls ?? 0)}
        description="Across all sitemaps"
        icon={<GlobeIcon className="h-4 w-4 text-muted-foreground" />}
        trend={{ value: 12.5, isPositive: true }}
      />
      
      <StatCard
        title="Indexed"
        value={formatNumber(stats?.indexedUrls ?? 0)}
        description={`${formatPercentage(indexingRate)} of total`}
        icon={<CheckCircleIcon className="h-4 w-4 text-green-500" />}
        trend={{ value: 4.2, isPositive: true }}
      />
      
      <StatCard
        title="Pending"
        value={formatNumber(stats?.pendingUrls ?? 0)}
        description="Awaiting submission"
        icon={<ClockIcon className="h-4 w-4 text-yellow-500" />}
        trend={{ value: 2.1, isPositive: false }}
      />
      
      <StatCard
        title="Errors"
        value={formatNumber(stats?.errorUrls ?? 0)}
        description="Requires attention"
        icon={<AlertTriangleIcon className="h-4 w-4 text-red-500" />}
        trend={{ value: 8.3, isPositive: true }} // Positive = errors decreasing
        invertTrend
      />
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  invertTrend?: boolean;
}

function StatCard({ title, value, description, icon, trend, invertTrend }: StatCardProps) {
  const trendColor = trend 
    ? (trend.isPositive !== invertTrend) 
      ? 'text-green-500' 
      : 'text-red-500'
    : '';
  
  const TrendIcon = trend?.isPositive ? ArrowUpIcon : ArrowDownIcon;
  
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{description}</span>
          {trend && (
            <span className={cn('flex items-center', trendColor)}>
              <TrendIcon className="h-3 w-3" />
              {trend.value}%
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatsOverviewSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20 mb-2" />
            <Skeleton className="h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}