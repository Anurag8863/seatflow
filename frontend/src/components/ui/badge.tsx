import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Ban, CircleCheck, CircleMinus, Clock, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EMPLOYEE_STATUS_LABEL, SEAT_STATUS_LABEL } from '@/lib/format';
import type { EmployeeStatus, SeatStatus } from '@/lib/types';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors [&_svg]:size-3 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary/10 text-primary',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-status-available/12 text-status-available',
        warning: 'border-transparent bg-status-reserved/15 text-status-reserved',
        danger: 'border-transparent bg-destructive/10 text-destructive',
        muted: 'border-transparent bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/**
 * Seat status is communicated by icon *and* text, never colour alone, so it
 * stays legible for colour-blind users and in high-contrast modes.
 */
const SEAT_STATUS_STYLES: Record<SeatStatus, { className: string; Icon: typeof CircleCheck }> = {
  AVAILABLE: { className: 'bg-status-available/12 text-status-available', Icon: CircleCheck },
  OCCUPIED: { className: 'bg-status-occupied/12 text-status-occupied', Icon: User },
  RESERVED: { className: 'bg-status-reserved/15 text-status-reserved', Icon: Clock },
  DISABLED: { className: 'bg-status-disabled/15 text-status-disabled', Icon: Ban },
};

export function SeatStatusBadge({ status, className }: { status: SeatStatus; className?: string }) {
  const { className: tone, Icon } = SEAT_STATUS_STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0',
        tone,
        className,
      )}
    >
      <Icon aria-hidden="true" />
      {SEAT_STATUS_LABEL[status]}
    </span>
  );
}

const EMPLOYEE_STATUS_STYLES: Record<EmployeeStatus, { className: string; Icon: typeof CircleCheck }> = {
  ACTIVE: { className: 'bg-status-available/12 text-status-available', Icon: CircleCheck },
  ON_LEAVE: { className: 'bg-status-reserved/15 text-status-reserved', Icon: Clock },
  INACTIVE: { className: 'bg-muted text-muted-foreground', Icon: CircleMinus },
};

export function EmployeeStatusBadge({ status, className }: { status: EmployeeStatus; className?: string }) {
  const { className: tone, Icon } = EMPLOYEE_STATUS_STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-transparent px-2 py-0.5 text-xs font-medium [&_svg]:size-3 [&_svg]:shrink-0',
        tone,
        className,
      )}
    >
      <Icon aria-hidden="true" />
      {EMPLOYEE_STATUS_LABEL[status]}
    </span>
  );
}

export { Badge, badgeVariants };
