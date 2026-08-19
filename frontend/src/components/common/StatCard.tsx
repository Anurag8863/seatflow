import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  icon: ComponentType<{ className?: string }>;
  tone?: 'primary' | 'available' | 'occupied' | 'reserved';
  hint?: ReactNode;
  /** Optional 0-100 progress rail rendered under the value. */
  progress?: number;
}

const TONES: Record<NonNullable<StatCardProps['tone']>, { bg: string; fg: string; bar: string }> = {
  primary: { bg: 'bg-primary/10', fg: 'text-primary', bar: 'bg-primary' },
  available: { bg: 'bg-status-available/12', fg: 'text-status-available', bar: 'bg-status-available' },
  occupied: { bg: 'bg-status-occupied/12', fg: 'text-status-occupied', bar: 'bg-status-occupied' },
  reserved: { bg: 'bg-status-reserved/15', fg: 'text-status-reserved', bar: 'bg-status-reserved' },
};

export function StatCard({ label, value, icon: Icon, tone = 'primary', hint, progress }: StatCardProps) {
  const palette = TONES[tone];

  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-card transition-shadow hover:shadow-card-hover">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', palette.bg)}>
          <Icon className={cn('size-4', palette.fg)} aria-hidden="true" />
        </span>
      </div>

      <p className="mt-3 text-2xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>

      {progress !== undefined ? (
        <div
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', palette.bar)}
            style={{ width: Math.min(100, Math.max(0, progress)) + '%' }}
          />
        </div>
      ) : null}

      {hint ? <div className="mt-2 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
