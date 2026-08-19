import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, TriangleAlert } from 'lucide-react';
import { getList } from '@/lib/api';
import type { Employee } from '@/lib/types';
import { useDebounce } from '@/hooks';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
import { Skeleton } from '@/components/ui/misc';

interface EmployeePickerProps {
  selectedId: string | null;
  onSelect: (employee: Employee) => void;
  /** Excluded from the list, e.g. the person already sitting at this seat. */
  excludeId?: string;
  labelId?: string;
}

/**
 * Searchable employee list used by the assign/move dialogs. People who already
 * hold a seat are shown with their current desk and flagged, because picking
 * them turns the action into a move rather than a plain assignment.
 */
export function EmployeePicker({ selectedId, onSelect, excludeId, labelId }: EmployeePickerProps) {
  const [term, setTerm] = React.useState('');
  const debounced = useDebounce(term, 250);

  const { data, isLoading } = useQuery({
    queryKey: ['employees', 'picker', debounced],
    queryFn: async () =>
      getList<Employee>('/employees', {
        search: debounced || undefined,
        pageSize: 25,
        sortBy: 'name',
        sortDir: 'asc',
      }),
  });

  const employees = (data?.items ?? []).filter((employee) => employee.id !== excludeId);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Search by name, ID, email or department"
          className="pl-9"
          aria-label="Search employees"
        />
      </div>

      <div
        role="listbox"
        aria-labelledby={labelId}
        className="max-h-64 overflow-y-auto scrollbar-thin rounded-lg border border-border"
      >
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : employees.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No employees match your search.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {employees.map((employee) => {
              const selected = employee.id === selectedId;
              const inactive = employee.status === 'INACTIVE';
              return (
                <li key={employee.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={inactive}
                    onClick={() => onSelect(employee)}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                      selected ? 'bg-accent' : 'hover:bg-muted',
                      inactive && 'cursor-not-allowed opacity-50',
                    )}
                  >
                    <Avatar name={employee.name} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">{employee.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {employee.employeeCode} · {employee.department}
                      </span>
                    </span>
                    {employee.seat ? (
                      <span className="flex shrink-0 items-center gap-1 rounded bg-status-reserved/15 px-1.5 py-0.5 text-[11px] font-medium text-status-reserved">
                        <TriangleAlert className="size-3" aria-hidden="true" />
                        {employee.seat.seatCode}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px] text-muted-foreground">No seat</span>
                    )}
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
