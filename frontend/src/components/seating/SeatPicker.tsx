import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { getList } from '@/lib/api';
import type { Seat } from '@/lib/types';
import { useDebounce } from '@/hooks';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/misc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWorkspace } from '@/providers/WorkspaceProvider';

interface SeatPickerProps {
  selectedId: string | null;
  onSelect: (seat: Seat) => void;
  excludeSeatId?: string;
  labelId?: string;
}

/** Lists assignable (available) seats, filterable by floor and free-text search. */
export function SeatPicker({ selectedId, onSelect, excludeSeatId, labelId }: SeatPickerProps) {
  const { buildings } = useWorkspace();
  const [term, setTerm] = React.useState('');
  const [floorId, setFloorId] = React.useState<string>('all');
  const debounced = useDebounce(term, 250);

  const { data, isLoading } = useQuery({
    queryKey: ['seats', 'picker', debounced, floorId],
    queryFn: async () =>
      getList<Seat>('/seats', {
        search: debounced || undefined,
        status: 'AVAILABLE',
        floorId: floorId === 'all' ? undefined : floorId,
        pageSize: 40,
        sortBy: 'seatCode',
        sortDir: 'asc',
      }),
  });

  const seats = (data?.items ?? []).filter((seat) => seat.id !== excludeSeatId);

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search seat code or zone"
            className="pl-9"
            aria-label="Search available seats"
          />
        </div>
        <Select value={floorId} onValueChange={setFloorId}>
          <SelectTrigger className="sm:w-52" aria-label="Filter by floor">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All floors</SelectItem>
            {buildings.flatMap((building) =>
              building.floors.map((floor) => (
                <SelectItem key={floor.id} value={floor.id}>
                  {building.code} · {floor.name}
                </SelectItem>
              )),
            )}
          </SelectContent>
        </Select>
      </div>

      <div
        role="listbox"
        aria-labelledby={labelId}
        className="max-h-56 overflow-y-auto scrollbar-thin rounded-lg border border-border p-2"
      >
        {isLoading ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : seats.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No available seats match these filters.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {seats.map((seat) => {
              const selected = seat.id === selectedId;
              return (
                <li key={seat.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onSelect(seat)}
                    className={cn(
                      'flex w-full flex-col items-start gap-0.5 rounded-lg border p-2 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      selected
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/40 hover:bg-muted',
                    )}
                  >
                    <span className="font-mono text-sm font-semibold">{seat.seatCode}</span>
                    <span className="truncate text-[11px] text-muted-foreground">{seat.floor.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
