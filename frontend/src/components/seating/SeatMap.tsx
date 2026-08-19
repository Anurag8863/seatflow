import * as React from 'react';
import { Ban, Clock, Maximize2, Minus, Plus } from 'lucide-react';
import type { FloorArea, FloorPlan, Seat } from '@/lib/types';
import { SEAT_STATUS_LABEL } from '@/lib/format';
import { cn, initials } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const CELL = 30;
const SEAT_SIZE = 52;
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 1.6;

const AREA_STYLES: Record<FloorArea['type'], string> = {
  MEETING_ROOM: 'bg-chart-4/10 border-chart-4/25',
  BREAK_ROOM: 'bg-chart-3/10 border-chart-3/25',
  PHONE_BOOTH: 'bg-chart-5/10 border-chart-5/25',
  RECEPTION: 'bg-chart-2/10 border-chart-2/25',
  UTILITY: 'bg-muted border-border',
  OPEN_WORKSPACE: 'bg-transparent border-dashed border-border',
};

const SEAT_STYLES: Record<Seat['status'], string> = {
  AVAILABLE:
    'border-dashed border-status-available/45 bg-status-available/[0.07] text-status-available hover:bg-status-available/15',
  OCCUPIED:
    'border-status-occupied/35 bg-status-occupied/12 text-status-occupied hover:bg-status-occupied/20',
  RESERVED:
    'border-dashed border-status-reserved/50 bg-status-reserved/12 text-status-reserved hover:bg-status-reserved/20',
  DISABLED: 'border-status-disabled/35 bg-status-disabled/10 text-status-disabled hover:bg-status-disabled/16',
};

interface SeatMapProps {
  plan: FloorPlan;
  onSelectSeat: (seat: Seat) => void;
  /** Seats outside the current filter are dimmed rather than hidden. */
  matchedSeatIds: Set<string> | null;
}

function SeatTile({
  seat,
  dimmed,
  onSelect,
}: {
  seat: Seat;
  dimmed: boolean;
  onSelect: (seat: Seat) => void;
}) {
  const label =
    seat.seatCode +
    ', ' +
    SEAT_STATUS_LABEL[seat.status] +
    (seat.occupant ? ', ' + seat.occupant.name + ', ' + seat.occupant.department : '');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onSelect(seat)}
          aria-label={label}
          className={cn(
            'absolute flex flex-col items-center justify-center gap-0.5 rounded-lg border text-[10px] font-medium transition-all',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            SEAT_STYLES[seat.status],
            dimmed && 'opacity-25 saturate-0',
          )}
          style={{
            left: seat.xPosition * CELL,
            top: seat.yPosition * CELL,
            width: SEAT_SIZE,
            height: SEAT_SIZE,
          }}
        >
          {seat.occupant ? (
            <span className="text-[11px] font-semibold leading-none">{initials(seat.occupant.name)}</span>
          ) : seat.status === 'DISABLED' ? (
            <Ban className="size-3.5" aria-hidden="true" />
          ) : seat.status === 'RESERVED' ? (
            <Clock className="size-3.5" aria-hidden="true" />
          ) : (
            <span className="size-1.5 rounded-full bg-current opacity-60" aria-hidden="true" />
          )}
          <span className="font-mono text-[9px] leading-none opacity-80">{seat.seatCode}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[15rem]">
        <p className="font-mono text-xs font-semibold text-foreground">{seat.seatCode}</p>
        <dl className="mt-1.5 space-y-1">
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Employee</dt>
            <dd className="min-w-0 flex-1 text-foreground">{seat.occupant?.name ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Department</dt>
            <dd className="min-w-0 flex-1 text-foreground">{seat.occupant?.department ?? '—'}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Location</dt>
            <dd className="min-w-0 flex-1 text-foreground">
              {seat.floor.name} · Zone {seat.zone}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Status</dt>
            <dd className="min-w-0 flex-1 text-foreground">{SEAT_STATUS_LABEL[seat.status]}</dd>
          </div>
        </dl>
      </TooltipContent>
    </Tooltip>
  );
}

export function SeatMap({ plan, onSelectSeat, matchedSeatIds }: SeatMapProps) {
  const [zoom, setZoom] = React.useState(1);

  const width = plan.floor.gridWidth * CELL;
  const height = plan.floor.gridHeight * CELL;

  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-card backdrop-blur">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((value) => Math.max(MIN_ZOOM, Number((value - 0.15).toFixed(2))))}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
        >
          <Minus aria-hidden="true" />
        </Button>
        <span className="w-11 text-center text-xs tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setZoom((value) => Math.min(MAX_ZOOM, Number((value + 0.15).toFixed(2))))}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
        >
          <Plus aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => setZoom(1)} aria-label="Reset zoom">
          <Maximize2 aria-hidden="true" />
        </Button>
      </div>

      <div className="overflow-auto scrollbar-thin rounded-xl border border-border bg-surface p-4">
        {/* The wrapper carries the scaled footprint so scrollbars stay accurate. */}
        <div style={{ width: width * zoom, height: height * zoom }}>
          <div
            className="relative"
            style={{ width, height, transform: 'scale(' + zoom + ')', transformOrigin: 'top left' }}
          >
            {plan.areas.map((area) => (
              <div
                key={area.id}
                className={cn(
                  'absolute rounded-lg border',
                  AREA_STYLES[area.type] ?? 'bg-muted border-border',
                )}
                style={{
                  left: area.x * CELL,
                  top: area.y * CELL,
                  width: area.width * CELL,
                  height: area.height * CELL,
                }}
              >
                <span className="absolute left-2 top-1.5 select-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {area.name}
                </span>
              </div>
            ))}

            {plan.seats.map((seat) => (
              <SeatTile
                key={seat.id}
                seat={seat}
                dimmed={matchedSeatIds !== null && !matchedSeatIds.has(seat.id)}
                onSelect={onSelectSeat}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function SeatLegend() {
  const items: Array<{ status: Seat['status']; label: string }> = [
    { status: 'AVAILABLE', label: 'Available' },
    { status: 'OCCUPIED', label: 'Occupied' },
    { status: 'RESERVED', label: 'Reserved' },
    { status: 'DISABLED', label: 'Out of service' },
  ];

  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {items.map((item) => (
        <li key={item.status} className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn('size-3 rounded border', SEAT_STYLES[item.status])} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
