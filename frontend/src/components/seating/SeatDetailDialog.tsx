import * as React from 'react';
import {
  Ban,
  Building2,
  CircleCheck,
  Clock,
  Mail,
  MapPin,
  Move,
  UserMinus,
  UserPlus,
} from 'lucide-react';
import type { Employee, Seat } from '@/lib/types';
import { formatDateTime, SEAT_STATUS_LABEL } from '@/lib/format';
import {
  useAssignSeat,
  useMoveEmployee,
  useReleaseSeat,
  useSetSeatStatus,
} from '@/lib/mutations';
import { useAuth } from '@/providers/AuthProvider';
import { Button } from '@/components/ui/button';
import { SeatStatusBadge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Avatar, Separator } from '@/components/ui/misc';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmployeePicker } from '@/components/employees/EmployeePicker';
import { SeatPicker } from './SeatPicker';

type Mode = 'details' | 'assign' | 'move';

interface SeatDetailDialogProps {
  seat: Seat | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function DetailRow({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm text-foreground">{value}</div>
      </div>
    </div>
  );
}

export function SeatDetailDialog({ seat, open, onOpenChange }: SeatDetailDialogProps) {
  const { canWrite } = useAuth();
  const [mode, setMode] = React.useState<Mode>('details');
  const [selectedEmployee, setSelectedEmployee] = React.useState<Employee | null>(null);
  const [selectedSeat, setSelectedSeat] = React.useState<Seat | null>(null);
  const [confirmRelease, setConfirmRelease] = React.useState(false);
  const [confirmDisable, setConfirmDisable] = React.useState(false);

  // Reset the dialog's internal state whenever it opens on a different seat.
  React.useEffect(() => {
    if (open) {
      setMode('details');
      setSelectedEmployee(null);
      setSelectedSeat(null);
    }
  }, [open, seat?.id]);

  const close = () => onOpenChange(false);

  const assign = useAssignSeat({ onSuccess: close });
  const move = useMoveEmployee({ onSuccess: close });
  const release = useReleaseSeat({
    onSuccess: () => {
      setConfirmRelease(false);
      close();
    },
  });
  const setStatus = useSetSeatStatus({
    onSuccess: () => {
      setConfirmDisable(false);
      close();
    },
  });

  if (!seat) return null;

  const occupant = seat.occupant;
  const busy = assign.isPending || move.isPending || release.isPending || setStatus.isPending;

  function confirmAssignment() {
    if (!selectedEmployee || !seat) return;
    // Picking someone who already has a desk turns this into an atomic move,
    // which is what keeps the "one seat per employee" rule intact.
    if (selectedEmployee.seat) {
      move.mutate({ employeeId: selectedEmployee.id, seatId: seat.id });
    } else {
      assign.mutate({ seatId: seat.id, employeeId: selectedEmployee.id });
    }
  }

  function confirmMove() {
    if (!selectedSeat || !occupant) return;
    move.mutate({ employeeId: occupant.id, seatId: selectedSeat.id });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <DialogTitle className="font-mono text-lg">{seat.seatCode}</DialogTitle>
              <SeatStatusBadge status={seat.status} />
            </div>
            <DialogDescription>
              {seat.floor.buildingName} · {seat.floor.name} · Zone {seat.zone}
            </DialogDescription>
          </DialogHeader>

          {mode === 'details' ? (
            <div className="space-y-4 overflow-y-auto scrollbar-thin">
              {occupant ? (
                <div className="rounded-lg border border-border bg-muted/40 p-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar name={occupant.name} className="size-10 text-sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground">{occupant.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {occupant.jobTitle} · {occupant.department}
                      </p>
                    </div>
                  </div>
                  <Separator className="my-3" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <DetailRow icon={Mail} label="Email" value={<span className="break-all">{occupant.email}</span>} />
                    <DetailRow icon={Building2} label="Employee ID" value={occupant.employeeCode} />
                    {seat.assignedAt ? (
                      <DetailRow icon={Clock} label="Seated since" value={formatDateTime(seat.assignedAt)} />
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-center">
                  <p className="text-sm font-medium text-foreground">
                    {seat.status === 'DISABLED'
                      ? 'This desk is out of service'
                      : seat.status === 'RESERVED'
                        ? 'This desk is being held'
                        : 'This desk is free'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {seat.status === 'DISABLED'
                      ? (seat.notes ?? 'Enable it before anyone can be seated here.')
                      : seat.status === 'RESERVED'
                        ? 'You can still assign someone to it.'
                        : 'Assign an employee to occupy it.'}
                  </p>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <DetailRow icon={MapPin} label="Location" value={seat.floor.buildingName + ' · ' + seat.floor.name} />
                <DetailRow icon={Building2} label="Status" value={SEAT_STATUS_LABEL[seat.status]} />
                {seat.notes && seat.status !== 'DISABLED' ? (
                  <DetailRow icon={Clock} label="Notes" value={seat.notes} />
                ) : null}
              </div>
            </div>
          ) : mode === 'assign' ? (
            <div className="space-y-3 overflow-y-auto scrollbar-thin">
              <p id="assign-label" className="text-sm font-medium text-foreground">
                Choose who should sit at {seat.seatCode}
              </p>
              <EmployeePicker
                labelId="assign-label"
                selectedId={selectedEmployee?.id ?? null}
                onSelect={setSelectedEmployee}
                excludeId={occupant?.id}
              />
              {selectedEmployee?.seat ? (
                <p className="rounded-md bg-status-reserved/10 px-3 py-2 text-xs text-status-reserved">
                  {selectedEmployee.name} currently holds {selectedEmployee.seat.seatCode}. Confirming will
                  release that desk and move them here.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3 overflow-y-auto scrollbar-thin">
              <p id="move-label" className="text-sm font-medium text-foreground">
                Choose a new desk for {occupant?.name}
              </p>
              <SeatPicker
                labelId="move-label"
                selectedId={selectedSeat?.id ?? null}
                onSelect={setSelectedSeat}
                excludeSeatId={seat.id}
              />
            </div>
          )}

          <DialogFooter>
            {mode === 'details' ? (
              canWrite ? (
                <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
                  <div className="flex flex-wrap gap-2">
                    {!occupant && seat.status !== 'DISABLED' ? (
                      <Button variant="outline" size="sm" onClick={() => setConfirmDisable(true)}>
                        <Ban aria-hidden="true" />
                        Disable
                      </Button>
                    ) : null}
                    {!occupant && seat.status === 'DISABLED' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={setStatus.isPending}
                        onClick={() => setStatus.mutate({ seatId: seat.id, status: 'AVAILABLE' })}
                      >
                        <CircleCheck aria-hidden="true" />
                        Enable
                      </Button>
                    ) : null}
                    {!occupant && seat.status === 'AVAILABLE' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={setStatus.isPending}
                        onClick={() => setStatus.mutate({ seatId: seat.id, status: 'RESERVED' })}
                      >
                        <Clock aria-hidden="true" />
                        Reserve
                      </Button>
                    ) : null}
                    {!occupant && seat.status === 'RESERVED' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={setStatus.isPending}
                        onClick={() => setStatus.mutate({ seatId: seat.id, status: 'AVAILABLE' })}
                      >
                        <CircleCheck aria-hidden="true" />
                        Clear hold
                      </Button>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {occupant ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => setConfirmRelease(true)}>
                          <UserMinus aria-hidden="true" />
                          Release
                        </Button>
                        <Button size="sm" onClick={() => setMode('move')}>
                          <Move aria-hidden="true" />
                          Move
                        </Button>
                      </>
                    ) : seat.status === 'DISABLED' ? null : (
                      <Button size="sm" onClick={() => setMode('assign')}>
                        <UserPlus aria-hidden="true" />
                        Assign employee
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Your role has read-only access to seating.
                </p>
              )
            ) : (
              <>
                <Button variant="outline" onClick={() => setMode('details')} disabled={busy}>
                  Back
                </Button>
                <Button
                  onClick={mode === 'assign' ? confirmAssignment : confirmMove}
                  disabled={mode === 'assign' ? !selectedEmployee : !selectedSeat}
                  loading={assign.isPending || move.isPending}
                >
                  {mode === 'assign' ? 'Assign to ' + seat.seatCode : 'Move to ' + (selectedSeat?.seatCode ?? 'seat')}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRelease}
        onOpenChange={setConfirmRelease}
        title={'Release seat ' + seat.seatCode + '?'}
        description={
          <>
            <span className="font-medium text-foreground">{occupant?.name}</span> will no longer be seated
            here, and {seat.seatCode} becomes available for someone else.
          </>
        }
        confirmLabel="Release seat"
        destructive
        loading={release.isPending}
        onConfirm={() => release.mutate({ seatId: seat.id })}
      />

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title={'Disable seat ' + seat.seatCode + '?'}
        description="A disabled desk is excluded from occupancy figures and cannot be assigned until it is enabled again."
        confirmLabel="Disable seat"
        destructive
        loading={setStatus.isPending}
        onConfirm={() => setStatus.mutate({ seatId: seat.id, status: 'DISABLED' })}
      />
    </>
  );
}
