import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { errorMessage, getList } from '@/lib/api';
import type { AiAction } from '@/lib/types';
import { aiActionLabel, formatDateTime, formatSmartDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/misc';
import { EmptyState, ErrorState } from '@/components/common/states';

const STATUS_TONES: Record<string, string> = {
  EXECUTED: 'bg-status-available/12 text-status-available',
  PENDING: 'bg-status-reserved/15 text-status-reserved',
  ANSWERED: 'bg-primary/10 text-primary',
  NEEDS_INPUT: 'bg-status-reserved/15 text-status-reserved',
  REJECTED: 'bg-destructive/10 text-destructive',
  FAILED: 'bg-destructive/10 text-destructive',
  CANCELLED: 'bg-muted text-muted-foreground',
};

export function AiStatusPill({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        STATUS_TONES[status] ?? 'bg-muted text-muted-foreground',
      )}
    >
      {status.replace('_', ' ')}
    </span>
  );
}

function AiActionDetail({ action }: { action: AiAction }) {
  const result = action.result as { summary?: string; affected?: Array<Record<string, string | null>> } | null;

  return (
    <div className="space-y-4 overflow-y-auto scrollbar-thin text-sm">
      <div>
        <p className="text-xs text-muted-foreground">Original prompt</p>
        <p className="mt-0.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground">
          {action.prompt}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Interpreted action</dt>
          <dd className="mt-0.5 font-medium text-foreground">{aiActionLabel(action.action)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Status</dt>
          <dd className="mt-0.5">
            <AiStatusPill status={action.status} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Requested by</dt>
          <dd className="mt-0.5 text-foreground">{action.user?.name ?? 'Unknown'}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Interpreted at</dt>
          <dd className="mt-0.5 text-foreground">{formatDateTime(action.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Provider</dt>
          <dd className="mt-0.5 text-foreground">
            {action.provider}
            {action.model ? ' · ' + action.model : ''}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Confidence</dt>
          <dd className="mt-0.5 tabular-nums text-foreground">
            {action.confidence === null ? '—' : Math.round(action.confidence * 100) + '%'}
          </dd>
        </div>
        {action.executedAt ? (
          <div>
            <dt className="text-xs text-muted-foreground">Executed at</dt>
            <dd className="mt-0.5 text-foreground">{formatDateTime(action.executedAt)}</dd>
          </div>
        ) : null}
      </dl>

      {action.preview ? (
        <div>
          <p className="text-xs text-muted-foreground">Interpreted change</p>
          <div className="mt-1 rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">{action.preview.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{action.preview.description}</p>
            <dl className="mt-2.5 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {action.preview.fields.map((field) => (
                <div key={field.label}>
                  <dt className="text-[11px] text-muted-foreground">{field.label}</dt>
                  <dd className="text-xs text-foreground">{field.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      ) : null}

      {result?.summary ? (
        <div>
          <p className="text-xs text-muted-foreground">Result</p>
          <p className="mt-0.5 text-foreground">{result.summary}</p>
        </div>
      ) : null}

      {action.errorMessage ? (
        <div>
          <p className="text-xs text-muted-foreground">Assistant response</p>
          <p className="mt-0.5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-foreground">
            {action.errorMessage}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function AiHistoryPanel() {
  const [selected, setSelected] = React.useState<AiAction | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ai-actions', 'history'],
    queryFn: async () => getList<AiAction>('/ai/actions', { page: 1, pageSize: 25 }),
  });

  const actions = data?.items ?? [];

  return (
    <>
      <Card className="flex h-full flex-col">
        <CardHeader>
          <CardTitle>AI action history</CardTitle>
          <CardDescription>Every prompt, what it was interpreted as, and what happened.</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          {isError ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : isLoading ? (
            <div className="space-y-3 px-5 pb-5">
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          ) : actions.length === 0 ? (
            <EmptyState
              icon={History}
              title="No AI actions yet"
              description="Prompts you send to the assistant will be recorded here."
            />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {actions.map((action) => (
                <li key={action.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(action)}
                    className="flex w-full flex-col gap-1 px-5 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs text-muted-foreground">
                        {formatSmartDate(action.createdAt)} · {action.user?.name ?? 'Unknown'}
                      </span>
                      <AiStatusPill status={action.status} />
                    </span>
                    <span className="line-clamp-2 text-sm text-foreground">“{action.prompt}”</span>
                    <span className="truncate text-xs text-muted-foreground">{aiActionLabel(action.action)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>AI action details</DialogTitle>
            <DialogDescription>
              A full record of how this request was interpreted and executed.
            </DialogDescription>
          </DialogHeader>
          {selected ? <AiActionDetail action={selected} /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
