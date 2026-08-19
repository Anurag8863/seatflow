import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Armchair, Ban, CircleCheck, Clock, MoreHorizontal, Search, UserMinus, UserPlus, X } from 'lucide-react';
import { api, errorMessage, getList } from '@/lib/api';
import type { Seat, SeatStatus } from '@/lib/types';
import { formatSmartDate } from '@/lib/format';
import { useDebounce } from '@/hooks';
import { useReleaseSeat, useSetSeatStatus } from '@/lib/mutations';
import { useAuth } from '@/providers/AuthProvider';
import { useWorkspace } from '@/providers/WorkspaceProvider';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { SeatStatusBadge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SortableHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { SeatDetailDialog } from '@/components/seating/SeatDetailDialog';

type SortKey = 'seatCode' | 'zone' | 'status' | 'updatedAt';

const COLUMN_COUNT = 8;

export function SeatsPage() {
  const { canWrite } = useAuth();
  const { buildings } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = React.useState('');
  const [floorId, setFloorId] = React.useState('all');
  const [zone, setZone] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [department, setDepartment] = React.useState('all');
  const [sortBy, setSortBy] = React.useState<SortKey>('seatCode');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);

  const [selectedSeat, setSelectedSeat] = React.useState<Seat | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [releaseTarget, setReleaseTarget] = React.useState<Seat | null>(null);
  const [disableTarget, setDisableTarget] = React.useState<Seat | null>(null);

  const debouncedSearch = useDebounce(search, 300);

  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, floorId, zone, status, department, pageSize]);

  const { data: zones = [] } = useQuery({
    queryKey: ['seats', 'zones', floorId],
    queryFn: async () =>
      (await api.get<string[]>('/seats/zones', floorId === 'all' ? undefined : { floorId })).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ['employees', 'departments'],
    queryFn: async () => (await api.get<Array<{ department: string; count: number }>>('/employees/departments')).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['seats', 'list', { debouncedSearch, floorId, zone, status, department, sortBy, sortDir, page, pageSize }],
    queryFn: async () =>
      getList<Seat>('/seats', {
        search: debouncedSearch || undefined,
        floorId: floorId === 'all' ? undefined : floorId,
        zone: zone === 'all' ? undefined : zone,
        status: status === 'all' ? undefined : status,
        department: department === 'all' ? undefined : department,
        sortBy,
        sortDir,
        page,
        pageSize,
      }),
    placeholderData: (previous) => previous,
  });

  // Memoised so the dialog-sync effect below does not re-run on every render.
  const seats = React.useMemo(() => data?.items ?? [], [data]);
  const meta = data?.meta ?? {};
  const filtersActive =
    search !== '' || floorId !== 'all' || zone !== 'all' || status !== 'all' || department !== 'all';

  const release = useReleaseSeat({ onSuccess: () => setReleaseTarget(null) });
  const setSeatStatus = useSetSeatStatus({ onSuccess: () => setDisableTarget(null) });

  // Deep link from global search: ?focus=<seatId> opens that seat.
  React.useEffect(() => {
    const focus = searchParams.get('focus');
    if (!focus) return;
    searchParams.delete('focus');
    setSearchParams(searchParams, { replace: true });
    void api.get<Seat>('/seats/' + focus).then(({ data: seat }) => {
      setSelectedSeat(seat);
      setDialogOpen(true);
    });
  }, [searchParams, setSearchParams]);

  // Keep the open dialog fresh after a mutation refetches the list.
  React.useEffect(() => {
    if (!selectedSeat) return;
    const refreshed = seats.find((seat) => seat.id === selectedSeat.id);
    if (refreshed && refreshed !== selectedSeat) setSelectedSeat(refreshed);
  }, [seats, selectedSeat]);

  function toggleSort(key: string) {
    const typed = key as SortKey;
    if (sortBy === typed) setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    else {
      setSortBy(typed);
      setSortDir('asc');
    }
  }

  function clearFilters() {
    setSearch('');
    setFloorId('all');
    setZone('all');
    setStatus('all');
    setDepartment('all');
  }

  function openSeat(seat: Seat) {
    setSelectedSeat(seat);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Seats" description="Every desk across the estate, with its current occupant and state." />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 xl:flex-row xl:items-center">
          <div className="relative xl:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search seat, zone or person"
              className="pl-9"
              aria-label="Search seats"
            />
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              value={floorId}
              onValueChange={(value) => {
                setFloorId(value);
                setZone('all');
              }}
            >
              <SelectTrigger aria-label="Filter by floor">
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

            <Select value={zone} onValueChange={setZone}>
              <SelectTrigger aria-label="Filter by zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All zones</SelectItem>
                {zones.map((item) => (
                  <SelectItem key={item} value={item}>
                    Zone {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="AVAILABLE">Available</SelectItem>
                <SelectItem value="OCCUPIED">Occupied</SelectItem>
                <SelectItem value="RESERVED">Reserved</SelectItem>
                <SelectItem value="DISABLED">Out of service</SelectItem>
              </SelectContent>
            </Select>

            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger aria-label="Filter by department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((item) => (
                  <SelectItem key={item.department} value={item.department}>
                    {item.department}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start xl:self-auto">
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
                    <SortableHead label="Seat" sortKey="seatCode" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <TableHead>Floor</TableHead>
                    <SortableHead label="Zone" sortKey="zone" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <SortableHead label="Status" sortKey="status" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <TableHead>Assigned employee</TableHead>
                    <TableHead>Department</TableHead>
                    <SortableHead label="Last updated" sortKey="updatedAt" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableSkeleton rows={8} columns={COLUMN_COUNT} />
                  ) : seats.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={COLUMN_COUNT} className="p-0">
                        <EmptyState
                          icon={Armchair}
                          title="No seats match these filters"
                          description={
                            filtersActive
                              ? 'Try a different combination of filters.'
                              : 'No desks have been configured yet.'
                          }
                          action={
                            filtersActive ? (
                              <Button variant="outline" size="sm" onClick={clearFilters}>
                                Clear filters
                              </Button>
                            ) : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    seats.map((seat) => (
                      <TableRow key={seat.id}>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => openSeat(seat)}
                            className="font-mono text-sm font-semibold text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {seat.seatCode}
                          </button>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {seat.floor.buildingCode} · {seat.floor.name}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{seat.zone}</TableCell>
                        <TableCell>
                          <SeatStatusBadge status={seat.status as SeatStatus} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {seat.occupant ? (
                            seat.occupant.name
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {seat.occupant ? seat.occupant.department : '—'}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatSmartDate(seat.updatedAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon-sm" aria-label={'Actions for seat ' + seat.seatCode}>
                                <MoreHorizontal aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onSelect={() => openSeat(seat)}>
                                <Armchair aria-hidden="true" />
                                View details
                              </DropdownMenuItem>

                              {canWrite ? (
                                <>
                                  {seat.occupant ? (
                                    <DropdownMenuItem destructive onSelect={() => setReleaseTarget(seat)}>
                                      <UserMinus aria-hidden="true" />
                                      Release seat
                                    </DropdownMenuItem>
                                  ) : seat.status === 'DISABLED' ? (
                                    <DropdownMenuItem
                                      onSelect={() => setSeatStatus.mutate({ seatId: seat.id, status: 'AVAILABLE' })}
                                    >
                                      <CircleCheck aria-hidden="true" />
                                      Enable seat
                                    </DropdownMenuItem>
                                  ) : (
                                    <>
                                      <DropdownMenuItem onSelect={() => openSeat(seat)}>
                                        <UserPlus aria-hidden="true" />
                                        Assign employee
                                      </DropdownMenuItem>
                                      {seat.status === 'AVAILABLE' ? (
                                        <DropdownMenuItem
                                          onSelect={() => setSeatStatus.mutate({ seatId: seat.id, status: 'RESERVED' })}
                                        >
                                          <Clock aria-hidden="true" />
                                          Reserve seat
                                        </DropdownMenuItem>
                                      ) : (
                                        <DropdownMenuItem
                                          onSelect={() => setSeatStatus.mutate({ seatId: seat.id, status: 'AVAILABLE' })}
                                        >
                                          <CircleCheck aria-hidden="true" />
                                          Clear hold
                                        </DropdownMenuItem>
                                      )}
                                      <DropdownMenuItem destructive onSelect={() => setDisableTarget(seat)}>
                                        <Ban aria-hidden="true" />
                                        Disable seat
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
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
              itemLabel="seats"
            />
          </>
        )}
      </Card>

      <SeatDetailDialog seat={selectedSeat} open={dialogOpen} onOpenChange={setDialogOpen} />

      <ConfirmDialog
        open={releaseTarget !== null}
        onOpenChange={(open) => !open && setReleaseTarget(null)}
        title={'Release seat ' + (releaseTarget?.seatCode ?? '') + '?'}
        description={
          <>
            <span className="font-medium text-foreground">{releaseTarget?.occupant?.name}</span> will be
            unassigned and the desk becomes available.
          </>
        }
        confirmLabel="Release seat"
        destructive
        loading={release.isPending}
        onConfirm={() => {
          if (releaseTarget) release.mutate({ seatId: releaseTarget.id });
        }}
      />

      <ConfirmDialog
        open={disableTarget !== null}
        onOpenChange={(open) => !open && setDisableTarget(null)}
        title={'Disable seat ' + (disableTarget?.seatCode ?? '') + '?'}
        description="Disabled desks are excluded from occupancy figures and cannot be assigned until enabled again."
        confirmLabel="Disable seat"
        destructive
        loading={setSeatStatus.isPending}
        onConfirm={() => {
          if (disableTarget) setSeatStatus.mutate({ seatId: disableTarget.id, status: 'DISABLED' });
        }}
      />
    </div>
  );
}
