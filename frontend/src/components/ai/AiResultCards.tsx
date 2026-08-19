import {
  ArrowRight,
  BadgeCheck,
  CircleAlert,
  CircleHelp,
  CircleX,
  Info,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import type { AiAnswer, AiExecutionResult, AiPlan } from '@/lib/types';
import { aiActionLabel } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

function ConfidenceMeter({ confidence }: { confidence: number }) {
  const percent = Math.round(confidence * 100);
  const tone = percent >= 85 ? 'bg-status-available' : percent >= 60 ? 'bg-status-reserved' : 'bg-destructive';

  return (
    <span className="flex items-center gap-1.5" title={'Interpretation confidence: ' + percent + '%'}>
      <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className={cn('block h-full rounded-full', tone)} style={{ width: percent + '%' }} />
      </span>
      <span className="text-[11px] tabular-nums text-muted-foreground">{percent}% confident</span>
    </span>
  );
}

/**
 * The confirmation gate. An interpreted mutation is *only* described here —
 * nothing is written until the administrator presses Confirm.
 */
export function AiConfirmationCard({
  plan,
  onConfirm,
  onCancel,
  confirming,
  cancelling,
}: {
  plan: AiPlan;
  onConfirm: () => void;
  onCancel: () => void;
  confirming: boolean;
  cancelling: boolean;
}) {
  const preview = plan.preview;
  if (!preview) return null;

  return (
    <div className="overflow-hidden rounded-xl border border-primary/30 bg-card shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/[0.06] px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Sparkles className="size-4 text-primary" aria-hidden="true" />
          AI understood
        </p>
        <div className="flex items-center gap-3">
          <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-medium text-primary">
            {aiActionLabel(plan.action)}
          </span>
          <ConfidenceMeter confidence={plan.confidence} />
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p className="text-base font-semibold text-foreground">{preview.title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{preview.description}</p>
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {preview.fields.map((field) => (
            <div key={field.label}>
              <dt className="text-xs text-muted-foreground">{field.label}</dt>
              <dd
                className={cn(
                  'mt-0.5 text-sm',
                  field.muted ? 'text-muted-foreground line-through decoration-muted-foreground/40' : 'font-medium text-foreground',
                )}
              >
                {field.value}
              </dd>
            </div>
          ))}
        </dl>

        {preview.rows?.length ? (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Employee
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Change
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((row) => (
                  <tr key={row.employeeName + row.toSeatCode}>
                    <td className="px-3 py-2">
                      <span className="block font-medium text-foreground">{row.employeeName}</span>
                      <span className="block text-xs text-muted-foreground">{row.department}</span>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5 font-mono text-xs">
                        <span className="text-muted-foreground">{row.fromSeatCode ?? 'No seat'}</span>
                        <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
                        <span className="font-semibold text-foreground">{row.toSeatCode}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {preview.warnings?.length ? (
          <ul className="space-y-1.5">
            {preview.warnings.map((warning) => (
              <li
                key={warning}
                className="flex items-start gap-2 rounded-md bg-status-reserved/10 px-3 py-2 text-xs text-status-reserved"
              >
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-2 border-t border-border bg-muted/30 px-4 py-3 sm:flex-row sm:justify-end">
        <Button variant="outline" onClick={onCancel} loading={cancelling} disabled={confirming}>
          Cancel
        </Button>
        <Button onClick={onConfirm} loading={confirming} disabled={cancelling}>
          <BadgeCheck aria-hidden="true" />
          Confirm change
        </Button>
      </div>
    </div>
  );
}

export function AiAnswerCard({ answer }: { answer: AiAnswer }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-card">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        {answer.text}
      </p>

      {answer.stats?.length ? (
        <dl className="mt-3.5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {answer.stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <dt className="text-[11px] text-muted-foreground">{stat.label}</dt>
              <dd className="text-base font-semibold tabular-nums text-foreground">{stat.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {answer.seats?.length ? (
        <ul className="mt-3.5 flex flex-wrap gap-2">
          {answer.seats.map((seat) => (
            <li
              key={seat.id}
              className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5"
              title={seat.buildingName + ' · ' + seat.floorName}
            >
              <span className="block font-mono text-xs font-semibold text-foreground">{seat.seatCode}</span>
              <span className="block text-[11px] text-muted-foreground">{seat.floorName}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AiClarificationCard({
  plan,
  onChoose,
  disabled,
}: {
  plan: AiPlan;
  onChoose: (optionId: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="rounded-xl border border-status-reserved/40 bg-status-reserved/[0.07] p-4">
      <p className="flex items-start gap-2 text-sm text-foreground">
        <CircleHelp className="mt-0.5 size-4 shrink-0 text-status-reserved" aria-hidden="true" />
        {plan.message}
      </p>

      {plan.options?.length ? (
        <ul className="mt-3 space-y-2">
          {plan.options.map((option) => (
            <li key={option.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChoose(option.id)}
                className="flex w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{option.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{option.description}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function AiRejectionCard({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/[0.07] p-4 text-sm text-foreground">
      <CircleX className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function AiErrorCard({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/50 p-4 text-sm text-foreground">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export function AiSuccessCard({ result }: { result: AiExecutionResult }) {
  return (
    <div className="rounded-xl border border-status-available/40 bg-status-available/[0.07] p-4">
      <p className="flex items-start gap-2 text-sm font-medium text-foreground">
        <BadgeCheck className="mt-0.5 size-4 shrink-0 text-status-available" aria-hidden="true" />
        {result.summary}
      </p>

      {result.affected.length ? (
        <ul className="mt-3 space-y-1.5">
          {result.affected.map((item, index) => (
            <li key={index} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-foreground">{item.employee?.name ?? 'Seat update'}</span>
              <span className="flex items-center gap-1.5 font-mono text-muted-foreground">
                {item.previousSeat?.seatCode ?? '—'}
                <ArrowRight className="size-3" aria-hidden="true" />
                <span className="font-semibold text-foreground">{item.seat?.seatCode ?? '—'}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {result.failures.length ? (
        <ul className="mt-3 space-y-1.5">
          {result.failures.map((failure, index) => (
            <li key={index} className="flex items-start gap-2 text-xs text-status-reserved">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium">{failure.summary}:</span> {failure.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
