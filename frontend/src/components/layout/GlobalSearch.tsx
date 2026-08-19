import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Armchair, Loader2, Search, User } from 'lucide-react';
import { api } from '@/lib/api';
import type { GlobalSearchResult } from '@/lib/types';
import { useDebounce } from '@/hooks';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { SeatStatusBadge } from '@/components/ui/badge';

/**
 * Header search. Results are keyboard navigable (arrow keys + Enter) and the
 * listbox is wired to the input with aria-activedescendant so screen readers
 * announce the highlighted option.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [term, setTerm] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [highlight, setHighlight] = React.useState(0);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const debounced = useDebounce(term, 250);
  const enabled = debounced.trim().length >= 2;

  const { data, isFetching } = useQuery({
    queryKey: ['global-search', debounced],
    queryFn: async () => (await api.get<GlobalSearchResult>('/search', { q: debounced, limit: 5 })).data,
    enabled,
    staleTime: 30 * 1000,
  });

  const options = React.useMemo(() => {
    if (!data) return [] as Array<{ id: string; kind: 'employee' | 'seat'; to: string }>;
    return [
      ...data.employees.map((employee) => ({
        id: 'employee-' + employee.id,
        kind: 'employee' as const,
        to: '/employees?focus=' + employee.id,
      })),
      ...data.seats.map((seat) => ({
        id: 'seat-' + seat.id,
        kind: 'seat' as const,
        to: '/seats?focus=' + seat.id,
      })),
    ];
  }, [data]);

  React.useEffect(() => setHighlight(0), [debounced]);

  // Close when focus or a click leaves the search area.
  React.useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  // Cmd/Ctrl+K focuses the field from anywhere in the app.
  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  function go(to: string) {
    setOpen(false);
    setTerm('');
    navigate(to);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!options.length) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (current + 1) % options.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => (current - 1 + options.length) % options.length);
    } else if (event.key === 'Enter') {
      const option = options[highlight];
      if (option) {
        event.preventDefault();
        go(option.to);
      }
    }
  }

  const showPanel = open && enabled;
  const hasResults = (data?.employees.length ?? 0) + (data?.seats.length ?? 0) > 0;

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-listbox"
        aria-activedescendant={showPanel && options[highlight] ? options[highlight]!.id : undefined}
        aria-label="Search employees and seats"
        placeholder="Search employees or seats..."
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-9 pl-9 pr-10"
      />
      {isFetching && enabled ? (
        <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-hidden="true" />
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
          ⌘K
        </kbd>
      )}

      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-border bg-popover shadow-popover animate-fade-in">
          <ul id="global-search-listbox" role="listbox" className="max-h-80 overflow-y-auto scrollbar-thin py-1">
            {!hasResults && !isFetching ? (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                No employees or seats match “{debounced}”.
              </li>
            ) : null}

            {data?.employees.length ? (
              <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Employees
              </li>
            ) : null}
            {data?.employees.map((employee, index) => (
              <li key={employee.id} role="none">
                <button
                  id={'employee-' + employee.id}
                  role="option"
                  aria-selected={highlight === index}
                  type="button"
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => go('/employees?focus=' + employee.id)}
                  className={cn(
                    'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                    highlight === index ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                  )}
                >
                  <User className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{employee.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {employee.department} · {employee.seat ? employee.seat.seatCode : 'No seat'}
                    </span>
                  </span>
                </button>
              </li>
            ))}

            {data?.seats.length ? (
              <li role="presentation" className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Seats
              </li>
            ) : null}
            {data?.seats.map((seat, index) => {
              const optionIndex = (data?.employees.length ?? 0) + index;
              return (
                <li key={seat.id} role="none">
                  <button
                    id={'seat-' + seat.id}
                    role="option"
                    aria-selected={highlight === optionIndex}
                    type="button"
                    onMouseEnter={() => setHighlight(optionIndex)}
                    onClick={() => go('/seats?focus=' + seat.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors',
                      highlight === optionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
                    )}
                  >
                    <Armchair className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{seat.seatCode}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {seat.floor.buildingName} · {seat.floor.name}
                        {seat.occupant ? ' · ' + seat.occupant.name : ''}
                      </span>
                    </span>
                    <SeatStatusBadge status={seat.status} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
