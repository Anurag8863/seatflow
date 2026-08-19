import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, Users, X } from 'lucide-react';
import { errorMessage, getList, api } from '@/lib/api';
import type { Employee, EmployeeStatus } from '@/lib/types';
import { useDebounce } from '@/hooks';
import { PageHeader } from '@/components/common/PageHeader';
import { Pagination } from '@/components/common/Pagination';
import { EmptyState, ErrorState, TableSkeleton } from '@/components/common/states';
import { Button } from '@/components/ui/button';
import { EmployeeStatusBadge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Avatar } from '@/components/ui/misc';
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
import { EmployeeDetailDialog } from '@/components/employees/EmployeeDetailDialog';

type SortKey = 'name' | 'employeeCode' | 'department' | 'jobTitle' | 'status';

const COLUMN_COUNT = 8;

export function EmployeesPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = React.useState('');
  const [department, setDepartment] = React.useState('all');
  const [seatState, setSeatState] = React.useState('all');
  const [status, setStatus] = React.useState('all');
  const [sortBy, setSortBy] = React.useState<SortKey>('name');
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(20);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const debouncedSearch = useDebounce(search, 300);

  // Deep link from global search: ?focus=<employeeId> opens that profile.
  React.useEffect(() => {
    const focus = searchParams.get('focus');
    if (focus) {
      setSelectedId(focus);
      setDialogOpen(true);
      searchParams.delete('focus');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Any filter change returns to the first page, otherwise the view can land
  // on a page that no longer exists.
  React.useEffect(() => {
    setPage(1);
  }, [debouncedSearch, department, seatState, status, pageSize]);

  const { data: departments = [] } = useQuery({
    queryKey: ['employees', 'departments'],
    queryFn: async () => (await api.get<Array<{ department: string; count: number }>>('/employees/departments')).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['employees', 'list', { debouncedSearch, department, seatState, status, sortBy, sortDir, page, pageSize }],
    queryFn: async () =>
      getList<Employee>('/employees', {
        search: debouncedSearch || undefined,
        department: department === 'all' ? undefined : department,
        seatState: seatState === 'all' ? undefined : seatState,
        status: status === 'all' ? undefined : status,
        sortBy,
        sortDir,
        page,
        pageSize,
      }),
    placeholderData: (previous) => previous,
  });

  const employees = data?.items ?? [];
  const meta = data?.meta ?? {};
  const filtersActive = search !== '' || department !== 'all' || seatState !== 'all' || status !== 'all';

  function toggleSort(key: string) {
    const typed = key as SortKey;
    if (sortBy === typed) {
      setSortDir((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortBy(typed);
      setSortDir('asc');
    }
  }

  function clearFilters() {
    setSearch('');
    setDepartment('all');
    setSeatState('all');
    setStatus('all');
  }

  function openEmployee(id: string) {
    setSelectedId(id);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Employees"
        description="The people directory, with each person's current desk and seating history."
      />

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative lg:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, ID, email or seat"
              className="pl-9"
              aria-label="Search employees"
            />
          </div>

          <div className="grid flex-1 gap-3 sm:grid-cols-3">
            <Select value={department} onValueChange={setDepartment}>
              <SelectTrigger aria-label="Filter by department">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All departments</SelectItem>
                {departments.map((item) => (
                  <SelectItem key={item.department} value={item.department}>
                    {item.department} ({item.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={seatState} onValueChange={setSeatState}>
              <SelectTrigger aria-label="Filter by seat state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any seat state</SelectItem>
                <SelectItem value="assigned">Has a seat</SelectItem>
                <SelectItem value="unassigned">No seat</SelectItem>
              </SelectContent>
            </Select>

            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger aria-label="Filter by employment status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="ON_LEAVE">On leave</SelectItem>
                <SelectItem value="INACTIVE">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtersActive ? (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start lg:self-auto">
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
                    <SortableHead label="Employee" sortKey="name" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <SortableHead label="ID" sortKey="employeeCode" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <TableHead>Email</TableHead>
                    <SortableHead label="Department" sortKey="department" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <SortableHead label="Role" sortKey="jobTitle" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                    <TableHead>Seat</TableHead>
                    <TableHead>Floor</TableHead>
                    <SortableHead label="Status" sortKey="status" activeKey={sortBy} direction={sortDir} onSort={toggleSort} />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableSkeleton rows={8} columns={COLUMN_COUNT} />
                  ) : employees.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={COLUMN_COUNT} className="p-0">
                        <EmptyState
                          icon={Users}
                          title="No employees match your search"
                          description={
                            filtersActive
                              ? 'Try a different search term or clear the filters.'
                              : 'The directory is empty. Seed the database to get started.'
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
                    employees.map((employee) => (
                      <TableRow
                        key={employee.id}
                        tabIndex={0}
                        role="button"
                        aria-label={'View ' + employee.name}
                        onClick={() => openEmployee(employee.id)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openEmployee(employee.id);
                          }
                        }}
                        className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      >
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={employee.name} />
                            <span className="whitespace-nowrap font-medium text-foreground">{employee.name}</span>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                          {employee.employeeCode}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{employee.email}</TableCell>
                        <TableCell className="whitespace-nowrap">{employee.department}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{employee.jobTitle}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {employee.seat ? (
                            <span className="font-mono text-xs font-medium text-foreground">
                              {employee.seat.seatCode}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {employee.seat ? employee.seat.floor.name : '—'}
                        </TableCell>
                        <TableCell>
                          <EmployeeStatusBadge status={employee.status as EmployeeStatus} />
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
              itemLabel="employees"
            />
          </>
        )}
        {isFetching && !isLoading ? (
          <span className="sr-only" aria-live="polite">
            Updating results
          </span>
        ) : null}
      </Card>

      <EmployeeDetailDialog employeeId={selectedId} open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
