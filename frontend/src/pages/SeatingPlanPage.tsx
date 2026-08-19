import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Armchair, LayoutGrid, Search } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { FloorPlan, Seat, SeatStatus } from '@/lib/types';
import { SEAT_STATUS_LABEL } from '@/lib/format';
import { useDebounce, useIsMobile } from '@/hooks';
import { cn, initials } from '@/lib/utils';
import { useWorkspace } from '@/providers/WorkspaceProvider';
import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState, ErrorState } from '@/components/common/states';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { SeatMap, SeatLegend } from '@/components/seating/SeatMap';
import { SeatDetailDialog } from '@/components/seating/SeatDetailDialog';

const STATUS_OPTIONS: Array<{ value: SeatStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'AVAILABLE', label: 'Available' },
  { value: 'OCCUPIED', label: 'Occupied' },
  { value: 'RESERVED', label: 'Reserved' },
  { value: 'DISABLED', label: 'Out of service' },
];

/** Compact card grid used instead of the floor map on phones and tablets. */
function SeatCardGrid({ seats, onSelect }: { seats: Seat[]; onSelect: (seat: Seat) => void }) {
  if (seats.length === 0) {
    return (
      <EmptyState
        icon={Armchair}
        title="No seats match these filters"
        description="Try clearing the search or choosing a different status."
      />
    );
  }

  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
      {seats.map((seat) => (
        <li key={seat.id}>
          <button
            type="button"
            onClick={() => onSelect(seat)}
            className="flex w-full flex-col gap-2 rounded-xl border border-border bg-card p-3 text-left shadow-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm font-semibold text-foreground">{seat.seatCode}</span>
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  seat.status === 'OCCUPIED' && 'bg-status-occupied',
                  seat.status === 'AVAILABLE' && 'bg-status-available',
                  seat.status === 'RESERVED' && 'bg-status-reserved',
                  seat.status === 'DISABLED' && 'bg-status-disabled',
                )}
                aria-hidden="true"
              />
            </div>
            {seat.occupant ? (
              <div className="flex items-center gap-2">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {initials(seat.occupant.name)}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium text-foreground">{seat.occupant.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{seat.occupant.department}</span>
                </span>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{SEAT_STATUS_LABEL[seat.status]} · Zone {seat.zone}</p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SeatingPlanPage() {
  const { buildings, building, floor, floorId, setBuilding, setFloor, isLoading: workspaceLoading } = useWorkspace();
  const isMobile = useIsMobile();

  const [search, setSearch] = React.useState('');
  const [department, setDepartment] = React.useState('all');
  const [status, setStatus] = React.useState<SeatStatus | 'all'>('all');
  const [selectedSeat, setSelectedSeat] = React.useState<Seat | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const debouncedSearch = useDebounce(search, 250);

  const { data: plan, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['floor-plan', floorId],
    queryFn: async () => (await api.get<FloorPlan>('/floors/' + floorId + '/plan')).data,
    enabled: Boolean(floorId),
  });

  const departments = React.useMemo(() => {
    const set = new Set<string>();
    for (const seat of plan?.seats ?? []) {
      if (seat.occupant) set.add(seat.occupant.department);
    }
    return [...set].sort();
  }, [plan]);

  const filtersActive = debouncedSearch.trim() !== '' || department !== 'all' || status !== 'all';

  const matchedSeats = React.useMemo(() => {
    if (!plan) return [];
    const term = debouncedSearch.trim().toLowerCase();
    return plan.seats.filter((seat) => {
      if (status !== 'all' && seat.status !== status) return false;
      if (department !== 'all' && seat.occupant?.department !== department) return false;
      if (!term) return true;
      return (
        seat.seatCode.toLowerCase().includes(term) ||
        seat.zone.toLowerCase().includes(term) ||
        (seat.occupant?.name.toLowerCase().includes(term) ?? false) ||
        (seat.occupant?.employeeCode.toLowerCase().includes(term) ?? false) ||
        (seat.occupant?.department.toLowerCase().includes(term) ?? false)
      );
    });
  }, [plan, debouncedSearch, department, status]);

  const matchedIds = React.useMemo(
    () => (filtersActive ? new Set(matchedSeats.map((seat) => seat.id)) : null),
    [filtersActive, matchedSeats],
  );

  function openSeat(seat: Seat) {
    setSelectedSeat(seat);
    setDialogOpen(true);
  }

  // Keep the open dialog in step with refreshed data after a mutation.
  React.useEffect(() => {
    if (!selectedSeat || !plan) return;
    const refreshed = plan.seats.find((seat) => seat.id === selectedSeat.id);
    if (refreshed && refreshed !== selectedSeat) setSelectedSeat(refreshed);
  }, [plan, selectedSeat]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Seating plan"
        description={
          plan
            ? plan.floor.building.name + ' · ' + plan.floor.name + ' · ' + plan.stats.total + ' desks'
            : 'Interactive floor map with live desk assignments.'
        }
      />

      {/* --------------------------------------------------------- filters */}
      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              value={building?.id ?? ''}
              onValueChange={setBuilding}
              disabled={workspaceLoading || buildings.length === 0}
            >
              <SelectTrigger aria-label="Building">
                <SelectValue placeholder="Building" />
              </SelectTrigger>
              <SelectContent>
                {buildings.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={floor?.id ?? ''} onValueChange={setFloor} disabled={!building}>
              <SelectTrigger aria-label="Floor">
                <SelectValue placeholder="Floor" />
              </SelectTrigger>
              <SelectContent>
                {building?.floors.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger aria-label="Department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={(value) => setStatus(value as SeatStatus | 'all')}>
              <SelectTrigger aria-label="Seat status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="relative lg:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a person or seat"
              className="pl-9"
              aria-label="Search this floor"
            />
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------- floor stats */}
      {plan ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SeatLegend />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {filtersActive ? matchedSeats.length + ' of ' + plan.stats.total + ' desks match · ' : ''}
            {plan.stats.occupied} occupied · {plan.stats.available} available · {plan.stats.occupancyRate}% full
          </p>
        </div>
      ) : null}

      {/* -------------------------------------------------------------- map */}
      {isError ? (
        <Card>
          <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
        </Card>
      ) : isLoading || !plan ? (
        <Skeleton className="h-[28rem] w-full rounded-xl" />
      ) : plan.seats.length === 0 ? (
        <Card>
          <EmptyState
            icon={LayoutGrid}
            title="This floor has no desks yet"
            description="Add seats to this floor to see them on the plan."
          />
        </Card>
      ) : isMobile ? (
        <SeatCardGrid seats={filtersActive ? matchedSeats : plan.seats} onSelect={openSeat} />
      ) : (
        <SeatMap plan={plan} matchedSeatIds={matchedIds} onSelectSeat={openSeat} />
      )}

      {!isMobile && plan && filtersActive && matchedSeats.length === 0 ? (
        <Card>
          <EmptyState
            title="No desks match these filters"
            description="Every desk on this floor has been dimmed. Clear a filter to bring them back."
          />
        </Card>
      ) : null}

      <SeatDetailDialog seat={selectedSeat} open={dialogOpen} onOpenChange={setDialogOpen} />

      {/* Screen readers get the same status summary the legend conveys visually. */}
      {plan ? (
        <p className="sr-only">
          {plan.stats.total} desks on {plan.floor.name}: {plan.stats.occupied} occupied, {plan.stats.available}{' '}
          available, {plan.stats.reserved} reserved, {plan.stats.disabled} out of service.
        </p>
      ) : null}
    </div>
  );
}
