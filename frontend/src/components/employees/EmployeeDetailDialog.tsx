import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Armchair, Building2, IdCard, Mail, Move, UserMinus, UserPlus } from 'lucide-react';
import { api, errorMessage } from '@/lib/api';
import type { EmployeeDetail, Seat } from '@/lib/types';
import { formatDate, formatDateTime } from '@/lib/format';
import { useMoveEmployee, useReleaseEmployeeSeat } from '@/lib/mutations';
import { useAuth } from '@/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { EmployeeStatusBadge, SeatStatusBadge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, Separator, Skeleton } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState } from '@/components/common/states';
import { SeatPicker } from '@/components/seating/SeatPicker';

interface EmployeeDetailDialogProps {
  employeeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="break-words text-sm text-foreground">{value}</div>
      </div>
    </div>
  );
}

export function EmployeeDetailDialog({ employeeId, open, onOpenChange }: EmployeeDetailDialogProps) {
  const { canWrite } = useAuth();
  const [pickingSeat, setPickingSeat] = React.useState(false);
  const [selectedSeat, setSelectedSeat] = React.useState<Seat | null>(null);
  const [confirmRelease, setConfirmRelease] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setPickingSeat(false);
      setSelectedSeat(null);
    }
  }, [open, employeeId]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['employees', 'detail', employeeId],
    queryFn: async () => (await api.get<EmployeeDetail>('/employees/' + employeeId)).data,
    enabled: open && Boolean(employeeId),
  });

  const move = useMoveEmployee({
    onSuccess: () => {
      setPickingSeat(false);
      setSelectedSeat(null);
    },
  });
  const release = useReleaseEmployeeSeat({ onSuccess: () => setConfirmRelease(false) });

  const employee = data?.employee;
  const history = data?.history ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          {isError ? (
            <ErrorState message={errorMessage(error)} onRetry={() => void refetch()} />
          ) : isLoading || !employee ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-12 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <Avatar name={employee.name} className="size-11 text-sm" />
                  <div className="min-w-0">
                    <DialogTitle className="truncate">{employee.name}</DialogTitle>
                    <DialogDescription className="truncate">
                      {employee.jobTitle} · {employee.department}
                    </DialogDescription>
                  </div>
                  <EmployeeStatusBadge status={employee.status} className="ml-auto shrink-0" />
                </div>
              </DialogHeader>

              {pickingSeat ? (
                <div className="space-y-3 overflow-y-auto scrollbar-thin">
                  <p id="employee-seat-label" className="text-sm font-medium">
                    {employee.seat ? 'Move ' + employee.name + ' to a new desk' : 'Choose a desk for ' + employee.name}
                  </p>
                  <SeatPicker
                    labelId="employee-seat-label"
                    selectedId={selectedSeat?.id ?? null}
                    onSelect={setSelectedSeat}
                    excludeSeatId={employee.seat?.id}
                  />
                </div>
              ) : (
                <div className="space-y-4 overflow-y-auto scrollbar-thin">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <InfoRow icon={IdCard} label="Employee ID" value={employee.employeeCode} />
                    <InfoRow icon={Mail} label="Email" value={employee.email} />
                    <InfoRow icon={Building2} label="Department" value={employee.department} />
                    <InfoRow icon={IdCard} label="Job title" value={employee.jobTitle} />
                  </div>

                  <Separator />

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Current seat
                    </p>
                    {employee.seat ? (
                      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/40 p-3">
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {employee.seat.seatCode}
                        </span>
                        <SeatStatusBadge status={employee.seat.status} />
                        <span className="text-xs text-muted-foreground">
                          {employee.seat.floor.buildingName} · {employee.seat.floor.name} · Zone{' '}
                          {employee.seat.zone}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          Since {formatDate(employee.seat.assignedAt)}
                        </span>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                        {employee.name} does not currently hold a desk.
                      </div>
                    )}
                  </div>

                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Seating history
                    </p>
                    {history.length === 0 ? (
                      <EmptyState
                        icon={Armchair}
                        title="No seating history yet"
                        description="Desk assignments will be listed here."
                        className="py-8"
                      />
                    ) : (
                      <ol className="space-y-2.5">
                        {history.map((entry) => (
                          <li key={entry.id} className="flex gap-3">
                            <span
                              className={
                                'mt-1.5 size-1.5 shrink-0 rounded-full ' +
                                (entry.active ? 'bg-status-occupied' : 'bg-muted-foreground/40')
                              }
                              aria-hidden="true"
                            />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm text-foreground">
                                <span className="font-mono font-medium">{entry.seatCode}</span>
                                <span className="text-muted-foreground">
                                  {' '}
                                  · {entry.buildingName} · {entry.floorName}
                                </span>
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatDateTime(entry.assignedAt)} —{' '}
                                {entry.releasedAt ? formatDateTime(entry.releasedAt) : 'present'}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                </div>
              )}

              <DialogFooter>
                {pickingSeat ? (
                  <>
                    <Button variant="outline" onClick={() => setPickingSeat(false)} disabled={move.isPending}>
                      Back
                    </Button>
                    <Button
                      disabled={!selectedSeat}
                      loading={move.isPending}
                      onClick={() => {
                        if (selectedSeat) move.mutate({ employeeId: employee.id, seatId: selectedSeat.id });
                      }}
                    >
                      {employee.seat ? 'Move to ' : 'Assign '}
                      {selectedSeat?.seatCode ?? 'seat'}
                    </Button>
                  </>
                ) : canWrite ? (
                  <>
                    {employee.seat ? (
                      <Button variant="outline" onClick={() => setConfirmRelease(true)}>
                        <UserMinus aria-hidden="true" />
                        Release seat
                      </Button>
                    ) : null}
                    <Button onClick={() => setPickingSeat(true)}>
                      {employee.seat ? <Move aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
                      {employee.seat ? 'Move seat' : 'Assign seat'}
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">Your role has read-only access to seating.</p>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRelease}
        onOpenChange={setConfirmRelease}
        title="Release this seat?"
        description={
          <>
            <span className="font-medium text-foreground">{employee?.name}</span> will give up{' '}
            <span className="font-mono">{employee?.seat?.seatCode}</span>, making it available for someone else.
          </>
        }
        confirmLabel="Release seat"
        destructive
        loading={release.isPending}
        onConfirm={() => {
          if (employee) release.mutate({ employeeId: employee.id });
        }}
      />
    </>
  );
}
