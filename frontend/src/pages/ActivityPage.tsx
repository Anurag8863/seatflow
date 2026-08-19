import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, History, Search, Sparkles, User, X } from 'lucide-react';
import { api, errorMessage, getList } from '@/lib/api';
import type { AuditLog } from '@/lib/types';
import { auditActionLabel, formatSmartDate, formatDateTime } from '@/lib/format';
import { useDebounce } from '@/hooks';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { AiHistoryPanel } from '@/components/ai/AiHistoryPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/misc';

const ACTIONS = [
  'EMPLOYEE_ASSIGNED',
  'EMPLOYEE_MOVED',
  'SEAT_RELEASED',
  'SEAT_DISABLED',
  'SEAT_ENABLED',
  'SEAT_RESERVED',
  'SEAT_UNRESERVED',
  'EMPLOYEE_CREATED',
  'EMPLOYEE_UPDATED',
  'AI_ACTION_EXECUTED',
];

const COLUMN_COUNT = 6;

function SourceBadge({ source }: { source: AuditLog['source'] }) {
  const isAi = source === 'AI';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium',
        isAi ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}
    >
      {isAi ? <Sparkles className="size-3" aria-hidden="true" /> : <User className="size-3" aria-hidden="true" />}
      {isAi ? 'AI' : source === 'SYSTEM' ? 'System' : 'Manual'}
    </span>
  );
}

function AuditDetailDialog({ log, onClose }: { log: AuditLog | null; onClose: () => void }) {
  return (
    <Dialog open={log !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{log ? auditActionLabel(log.action) : ''}</DialogTitle>
          <DialogDescription>{log?.summary}</DialogDescription>
        </DialogHeader>
        {log ? (
          <div className="space-y-4 overflow-y-auto scrollbar-thin text-sm">
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">When</dt>
                <dd className="mt-0.5 text-foreground">{formatDateTime(log.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Performed by</dt>
                <dd className="mt-0.5 text-foreground">{log.user?.name ?? 'System'}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Source</dt>
                <dd className="mt-0.5">
                  <SourceBadge source={log.source} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Result</dt>
                <dd className="mt-0.5 text-foreground">{log.status === 'SUCCESS' ? 'Success' : 'Failed'}</dd>
              </div>
              {log.employee ? (
                <div>
                  <dt className="text-xs text-muted-foreground">Employee</dt>
                  <dd className="mt-0.5 text-foreground">
                    {log.employee.name}{' '}
                    <span className="text-muted-foreground">({log.employee.employeeCode})</span>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs text-muted-foreground">Seat change</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-foreground">
                  <span className="text-muted-foreground">{log.previousSeat?.seatCode ?? '—'}</span>
                  <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
                  <span className="font-semibold">{log.newSeat?.seatCode ?? '—'}</span>
                </dd>
              </div>
            </dl>

            {log.metadata ? (
              <div>
                <p className="text-xs text-muted-foreground">Metadata</p>
                <pre className="mt-1 max-h-56 overflow-auto scrollbar-thin rounded-lg border border-border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed text-foreground">
                  {JSON.stringify(log.metadata, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AuditLogTab() {
  const [search, setSearch] = React.useState('');
  const [action, setAction] = React.useState('all');
  const [source, setSource] = React.useState('all');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);
  const [selected, setSelected] = React.useState<AuditLog | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, action, source, pageSize]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['audit-logs', 'list', { debouncedSearch, action, source, page, pageSize }],
    queryFn: async () =>
      getList<AuditLog>('/audit-logs', {
        search: debouncedSearch || undefined,
        action: action === 'all' ? undefined : action,
        source: source === 'all' ? undefined : source,
        page,
        pageSize,
      }),
    placeholderData: (previous) => previous,
  });

  const { data: summary } = useQuery({
    queryKey: ['audit-logs', 'summary'],
    queryFn: async () =>
      (await api.get<{ bySource: Array<{ source: string; count: number }>; total: number }>('/audit-logs/summary')).data,
    staleTime: 60 * 1000,
  });

  const logs = data?.items ?? [];
  const meta = data?.meta ?? {};
  const filtersActive = search !== '' || action !== 'all' || source !== 'all';

  return (
    <div className="space-y-5">
      {summary ? (
        <div className="flex flex-wrap gap-3">
          <div className="rounded-lg border border-border bg-card px-3.5 py-2 shadow-card">
            <p className="text-[11px] text-muted-foreground">Total events</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">{summary.total}</p>
          </div>
          {summary.bySource.map((item) => (
            <div key={item.source} className="rounded-lg border border-border bg-card px-3.5 py-2 shadow-card">
              <p className="text-[11px] text-muted-foreground">
                {item.source === 'AI' ? 'AI assistant' : item.source === 'MANUAL' ? 'Manual' : 'System'}
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground">{item.count}</p>
            </div>
          ))}
        </div>
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search summary, person or seat"
              className="pl-9"
              aria-label="Search the audit log"
            />
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-2">
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger aria-label="Filter by action">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ACTIONS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {auditActionLabel(item)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={source} onValueChange={setSource}>
              <SelectTrigger aria-label="Filter by source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                <SelectItem value="MANUAL">Manual</SelectItem>
                <SelectItem value="AI">AI assistant</SelectItem>
                <SelectItem value="SYSTEM">System</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtersActive ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setAction('all');
                setSource('all');
              }}
              className="self-start lg:self-auto"
            >
              <X aria-hidden="true" />
              Clear
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        {isError ? (
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        ) : (
          <>
            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Employee</TableHead>
                    <TableHead>Change</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableSkeleton rows={8} columns={COLUMN_COUNT} />
                  ) : logs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={COLUMN_COUNT} className="p-0">
                        <EmptyState
                          icon={History}
                          title="No seating activity yet"
                          description={
                            filtersActive
                              ? 'No audit records match these filters.'
                              : 'Assignments, moves and releases will be recorded here.'
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    logs.map((log) => (
                      <TableRow
                        key={log.id}
                        tabIndex={0}
                        role="button"
                        aria-label={'View details for ' + log.summary}
                        onClick={() => setSelected(log)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setSelected(log);
                          }
                        }}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatSmartDate(log.createdAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium text-foreground">
                          {auditActionLabel(log.action)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{log.employee?.name ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span className="flex items-center gap-1.5 font-mono text-xs">
                            <span className="text-muted-foreground">{log.previousSeat?.seatCode ?? '—'}</span>
                            <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
                            <span className="font-medium text-foreground">{log.newSeat?.seatCode ?? '—'}</span>
                          </span>
                        </TableCell>
                        <TableCell>
                          <SourceBadge source={log.source} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {log.user?.name ?? 'System'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableWrapper>

            <Pagination
              page={meta.page ?? 1}
              pageSize={meta.pageSize ?? pageSize}
              total={meta.total ?? 0}
              totalPages={meta.totalPages ?? 1}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
              itemLabel="events"
            />
          </>
        )}
      </Card>

      <AuditDetailDialog log={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

export function ActivityPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Activity"
        description="A complete, immutable record of every seating change — manual and AI-driven."
      />

      <Tabs defaultValue="audit">
        <TabsList>
          <TabsTrigger value="audit">Audit log</TabsTrigger>
          <TabsTrigger value="ai">AI actions</TabsTrigger>
        </TabsList>
        <TabsContent value="audit">
          <AuditLogTab />
        </TabsContent>
        <TabsContent value="ai">
          <div className="max-w-3xl">
            <AiHistoryPanel />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
