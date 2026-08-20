import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Armchair,
  ArrowRight,
  CircleCheck,
  Gauge,
  Sparkles,
  UserCheck,
  Users,
} from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { DashboardStats } from '@/lib/types';
import { auditActionLabel, aiActionLabel, formatSmartDate } from '@/lib/format';
import { PageHeader } from '@/components/common/PageHeader';
import { StatCard } from '@/components/common/StatCard';
import { ChartTooltip } from '@/components/common/ChartTooltip';
import { CardSkeleton, EmptyState, ErrorState } from '@/components/common/states';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';

const STATUS_COLORS: Record<string, string> = {
  OCCUPIED: 'hsl(var(--status-occupied))',
  AVAILABLE: 'hsl(var(--status-available))',
  RESERVED: 'hsl(var(--status-reserved))',
  DISABLED: 'hsl(var(--status-disabled))',
};

function shortDate(iso: string): string {
  const date = new Date(iso + 'T00:00:00');
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => (await api.get<DashboardStats>('/dashboard')).data,
  });

  if (isError) {
    return (
      <Card>
        <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
      </Card>
    );
  }

  const totals = data?.totals;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Occupancy, capacity and the latest seating changes across every office."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/seating-plan">
              Open seating plan
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      {/* ------------------------------------------------------------- KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !totals ? (
          Array.from({ length: 4 }, (_, index) => <CardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              label="Total employees"
              value={totals.employees}
              icon={Users}
              tone="primary"
              hint={totals.unassignedEmployees + ' without a seat'}
            />
            <StatCard
              label="Assigned employees"
              value={totals.assignedEmployees}
              icon={UserCheck}
              tone="occupied"
              progress={totals.employees ? (totals.assignedEmployees / totals.employees) * 100 : 0}
              hint={
                totals.employees
                  ? Math.round((totals.assignedEmployees / totals.employees) * 100) + '% of the directory'
                  : 'No employees yet'
              }
            />
            <StatCard
              label="Available seats"
              value={totals.availableSeats}
              icon={CircleCheck}
              tone="available"
              hint={totals.reservedSeats + ' reserved · ' + totals.disabledSeats + ' out of service'}
            />
            <StatCard
              label="Occupancy rate"
              value={totals.occupancyRate + '%'}
              icon={Gauge}
              tone="reserved"
              progress={totals.occupancyRate}
              hint={totals.occupiedSeats + ' of ' + (totals.seats - totals.disabledSeats) + ' usable seats'}
            />
          </>
        )}
      </div>

      {/* --------------------------------------------------------- charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Occupied seats over time</CardTitle>
            <CardDescription>Desks held on each of the last 14 days.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-56 w-full" />
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.occupancyTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="occupancyFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                      width={44}
                    />
                    <Tooltip
                      content={<ChartTooltip labelFormatter={shortDate} />}
                      cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="occupied"
                      name="Occupied"
                      stroke="hsl(var(--chart-1))"
                      strokeWidth={2}
                      fill="url(#occupancyFill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Seat status</CardTitle>
            <CardDescription>How the full desk inventory is being used.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-56 w-full" />
            ) : data.totals.seats === 0 ? (
              <EmptyState icon={Armchair} title="No seats configured" description="Add floors and desks to see this breakdown." />
            ) : (
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data.seatBreakdown.filter((slice) => slice.count > 0)}
                      dataKey="count"
                      nameKey="label"
                      innerRadius="58%"
                      outerRadius="82%"
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {data.seatBreakdown
                        .filter((slice) => slice.count > 0)
                        .map((slice) => (
                          <Cell key={slice.status} fill={STATUS_COLORS[slice.status] ?? 'hsl(var(--chart-1))'} />
                        ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      verticalAlign="bottom"
                      height={36}
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Department distribution</CardTitle>
            <CardDescription>Headcount against how many of them currently hold a desk.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading || !data ? (
              <Skeleton className="h-64 w-full" />
            ) : data.departmentDistribution.length === 0 ? (
              <EmptyState icon={Users} title="No employees yet" description="Add people to see department breakdowns." />
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data.departmentDistribution}
                    layout="vertical"
                    margin={{ top: 0, right: 12, left: 8, bottom: 0 }}
                    barGap={2}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    />
                    <YAxis
                      type="category"
                      dataKey="department"
                      tickLine={false}
                      axisLine={false}
                      width={88}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
                    <Legend
                      verticalAlign="top"
                      align="right"
                      height={28}
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => <span className="text-xs text-muted-foreground">{value}</span>}
                    />
                    <Bar dataKey="employees" name="Headcount" fill="hsl(var(--chart-4))" radius={[0, 4, 4, 0]} maxBarSize={12} />
                    <Bar dataKey="seated" name="Seated" fill="hsl(var(--chart-1))" radius={[0, 4, 4, 0]} maxBarSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Occupancy by floor</CardTitle>
            <CardDescription>Excludes desks that are out of service.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3.5">
            {isLoading || !data ? (
              Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-9 w-full" />)
            ) : data.floorOccupancy.length === 0 ? (
              <EmptyState icon={Armchair} title="No floors configured" />
            ) : (
              data.floorOccupancy.map((floor) => (
                <div key={floor.floorId}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">
                      {floor.floorName}
                      <span className="ml-1.5 text-xs font-normal text-muted-foreground">{floor.buildingName}</span>
                    </p>
                    <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {floor.occupied}/{floor.total} · {floor.occupancyRate}%
                    </p>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuenow={floor.occupancyRate}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={floor.floorName + ' occupancy'}
                  >
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-500"
                      style={{ width: floor.occupancyRate + '%' }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* ---------------------------------------------------------- feeds */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Recent seating changes</CardTitle>
              <CardDescription>The latest entries from the audit log.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/activity">View all</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !data ? (
              <div className="space-y-3 p-5 pt-0">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : data.recentActivity.length === 0 ? (
              <EmptyState title="No seating activity yet" description="Assignments and moves will appear here." />
            ) : (
              <ul className="divide-y divide-border">
                {data.recentActivity.map((log) => (
                  <li key={log.id} className="flex items-start gap-3 px-5 py-3">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{log.summary}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {auditActionLabel(log.action)} · {log.source === 'AI' ? 'AI assistant' : 'Manual'} ·{' '}
                        {formatSmartDate(log.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
            <div>
              <CardTitle>Recent AI actions</CardTitle>
              <CardDescription>Prompts interpreted by the seating assistant.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link to="/ai-assistant">Open assistant</Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading || !data ? (
              <div className="space-y-3 p-5 pt-0">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : data.recentAiActions.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="No AI activity yet"
                description="Ask the assistant to move someone and it will show up here."
                action={
                  <Button asChild size="sm" variant="outline">
                    <Link to="/ai-assistant">Try the assistant</Link>
                  </Button>
                }
              />
            ) : (
              <ul className="divide-y divide-border">
                {data.recentAiActions.map((action) => (
                  <li key={action.id} className="flex items-start gap-3 px-5 py-3">
                    <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">“{action.prompt}”</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {aiActionLabel(action.action)} · {action.status.toLowerCase()} ·{' '}
                        {formatSmartDate(action.createdAt)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}