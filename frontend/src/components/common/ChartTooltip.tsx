import type { TooltipProps } from 'recharts';

type Payload = NonNullable<TooltipProps<number, string>['payload']>;

interface ChartTooltipProps extends TooltipProps<number, string> {
  labelFormatter?: (label: string) => string;
  valueFormatter?: (value: number, name: string) => string;
}

/**
 * Recharts' default tooltip ignores our theme tokens, so every chart uses this
 * one instead — same surface, border and type scale as the rest of the app.
 */
export function ChartTooltip({ active, payload, label, labelFormatter, valueFormatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  const items = payload as Payload;

  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-popover">
      {label !== undefined && label !== '' ? (
        <p className="mb-1.5 font-medium text-foreground">
          {labelFormatter ? labelFormatter(String(label)) : String(label)}
        </p>
      ) : null}
      <ul className="space-y-1">
        {items.map((item, index) => (
          <li key={index} className="flex items-center gap-2">
            <span
              className="size-2 shrink-0 rounded-[2px]"
              style={{ backgroundColor: item.color ?? 'hsl(var(--chart-1))' }}
              aria-hidden="true"
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground">
              {valueFormatter
                ? valueFormatter(Number(item.value ?? 0), String(item.name ?? ''))
                : String(item.value ?? '')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
