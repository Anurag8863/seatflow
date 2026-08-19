import { format, formatDistanceToNowStrict, isToday, isYesterday, parseISO } from 'date-fns';
import type { AuditSource, EmployeeStatus, SeatStatus } from './types';

export function formatDateTime(value: string): string {
  return format(parseISO(value), 'd MMM yyyy, HH:mm');
}

export function formatDate(value: string): string {
  return format(parseISO(value), 'd MMM yyyy');
}

export function formatTime(value: string): string {
  return format(parseISO(value), 'HH:mm');
}

/** "Today, 10:42" / "Yesterday, 16:03" / "12 Mar, 09:15" — compact for tables. */
export function formatSmartDate(value: string): string {
  const date = parseISO(value);
  if (isToday(date)) return 'Today, ' + format(date, 'HH:mm');
  if (isYesterday(date)) return 'Yesterday, ' + format(date, 'HH:mm');
  return format(date, 'd MMM, HH:mm');
}

export function formatRelative(value: string): string {
  return formatDistanceToNowStrict(parseISO(value), { addSuffix: true });
}

export const SEAT_STATUS_LABEL: Record<SeatStatus, string> = {
  AVAILABLE: 'Available',
  OCCUPIED: 'Occupied',
  RESERVED: 'Reserved',
  DISABLED: 'Disabled',
};

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  ACTIVE: 'Active',
  ON_LEAVE: 'On leave',
  INACTIVE: 'Inactive',
};

export const AUDIT_SOURCE_LABEL: Record<AuditSource, string> = {
  MANUAL: 'Manual',
  AI: 'AI assistant',
  SYSTEM: 'System',
};

const AUDIT_ACTION_LABEL: Record<string, string> = {
  EMPLOYEE_ASSIGNED: 'Employee assigned',
  EMPLOYEE_MOVED: 'Employee moved',
  SEAT_RELEASED: 'Seat released',
  SEAT_DISABLED: 'Seat disabled',
  SEAT_ENABLED: 'Seat enabled',
  SEAT_RESERVED: 'Seat reserved',
  SEAT_UNRESERVED: 'Reservation cleared',
  EMPLOYEE_CREATED: 'Employee added',
  EMPLOYEE_UPDATED: 'Employee updated',
  AI_ACTION_EXECUTED: 'AI action executed',
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABEL[action] ?? humanise(action);
}

const AI_ACTION_LABEL: Record<string, string> = {
  MOVE_EMPLOYEE: 'Move employee',
  ASSIGN_EMPLOYEE: 'Assign employee',
  RELEASE_SEAT: 'Release seat',
  BULK_MOVE_DEPARTMENT: 'Bulk move',
  QUERY_AVAILABLE_SEATS: 'Availability query',
  QUERY_OCCUPANCY: 'Occupancy query',
  FIND_SEAT_NEAR_TEAM: 'Seat suggestion',
  CLARIFICATION_NEEDED: 'Needs clarification',
  UNSUPPORTED: 'Unsupported request',
};

export function aiActionLabel(action: string): string {
  return AI_ACTION_LABEL[action] ?? humanise(action);
}

export function humanise(value: string): string {
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function formatPercent(value: number): string {
  return Math.round(value) + '%';
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count + ' ' + (count === 1 ? singular : (plural ?? singular + 's'));
}
