export type SeatStatus = 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'DISABLED';
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
export type AuditSource = 'MANUAL' | 'AI' | 'SYSTEM';
export type Role = 'ADMIN' | 'MANAGER' | 'VIEWER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  lastLoginAt?: string | null;
  createdAt?: string;
}

export interface FloorSummary {
  id: string;
  name: string;
  floorNumber: number;
  buildingId: string;
  buildingName: string;
  buildingCode: string;
}

export interface SeatOccupant {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
}

export interface Seat {
  id: string;
  seatCode: string;
  zone: string;
  status: SeatStatus;
  notes: string | null;
  xPosition: number;
  yPosition: number;
  updatedAt: string;
  floor: FloorSummary;
  occupant: SeatOccupant | null;
  assignedAt: string | null;
}

export interface EmployeeSeat {
  id: string;
  seatCode: string;
  zone: string;
  status: SeatStatus;
  assignedAt: string;
  floor: FloorSummary;
}

export interface Employee {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  department: string;
  jobTitle: string;
  status: EmployeeStatus;
  createdAt: string;
  updatedAt: string;
  seat: EmployeeSeat | null;
}

export interface SeatingHistoryEntry {
  id: string;
  seatId: string;
  seatCode: string;
  zone: string;
  floorName: string;
  buildingName: string;
  assignedAt: string;
  releasedAt: string | null;
  active: boolean;
}

export interface EmployeeDetail {
  employee: Employee;
  history: SeatingHistoryEntry[];
}

export interface AuditLog {
  id: string;
  action: string;
  source: AuditSource;
  status: 'SUCCESS' | 'FAILED';
  summary: string;
  metadata: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string } | null;
  employee: { id: string; name: string; employeeCode: string; department: string } | null;
  previousSeat: { id: string; seatCode: string } | null;
  newSeat: { id: string; seatCode: string } | null;
}

export interface Building {
  id: string;
  name: string;
  code: string;
  address: string;
  floors: Array<{
    id: string;
    name: string;
    floorNumber: number;
    seatCount: number;
    occupiedCount: number;
  }>;
}

export interface FloorArea {
  id: string;
  name: string;
  type:
    | 'MEETING_ROOM'
    | 'BREAK_ROOM'
    | 'PHONE_BOOTH'
    | 'RECEPTION'
    | 'UTILITY'
    | 'OPEN_WORKSPACE';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloorPlan {
  floor: {
    id: string;
    name: string;
    floorNumber: number;
    gridWidth: number;
    gridHeight: number;
    building: { id: string; name: string; code: string; address: string };
  };
  areas: FloorArea[];
  seats: Seat[];
  stats: {
    total: number;
    occupied: number;
    available: number;
    reserved: number;
    disabled: number;
    occupancyRate: number;
  };
}

export interface DashboardStats {
  totals: {
    employees: number;
    activeEmployees: number;
    assignedEmployees: number;
    unassignedEmployees: number;
    seats: number;
    occupiedSeats: number;
    availableSeats: number;
    reservedSeats: number;
    disabledSeats: number;
    occupancyRate: number;
    buildings: number;
    floors: number;
  };
  seatBreakdown: Array<{ status: SeatStatus; label: string; count: number }>;
  departmentDistribution: Array<{ department: string; employees: number; seated: number }>;
  floorOccupancy: Array<{
    floorId: string;
    floorName: string;
    buildingName: string;
    total: number;
    occupied: number;
    available: number;
    occupancyRate: number;
  }>;
  occupancyTrend: Array<{ date: string; occupied: number }>;
  recentActivity: AuditLog[];
  recentAiActions: Array<{
    id: string;
    prompt: string;
    action: string;
    status: string;
    createdAt: string;
    userName: string | null;
  }>;
}

export interface SeatingResult {
  seat: Seat | null;
  previousSeat: Seat | null;
  employee: Employee | null;
  summary: string;
}

// ------------------------------------------------------------------------- AI

export type AiPlanKind = 'mutation' | 'answer' | 'clarification' | 'rejected';

export interface AiPreviewField {
  label: string;
  value: string;
  muted?: boolean;
}

export interface AiPreviewRow {
  employeeName: string;
  department: string;
  fromSeatCode: string | null;
  toSeatCode: string | null;
}

export interface AiPreview {
  title: string;
  description: string;
  fields: AiPreviewField[];
  rows?: AiPreviewRow[];
  warnings?: string[];
}

export interface AiAnswerSeat {
  id: string;
  seatCode: string;
  zone: string;
  floorName: string;
  buildingName: string;
  status: SeatStatus;
}

export interface AiAnswer {
  text: string;
  seats?: AiAnswerSeat[];
  stats?: Array<{ label: string; value: string }>;
}

export interface AiAmbiguityOption {
  id: string;
  label: string;
  description: string;
}

export interface AiPlan {
  aiActionId: string;
  kind: AiPlanKind;
  action: string;
  provider: string;
  model: string;
  confidence: number;
  reason: string | null;
  preview?: AiPreview;
  answer?: AiAnswer;
  message?: string;
  options?: AiAmbiguityOption[];
  /** Tells the client which field to resend the chosen option in. */
  optionKind?: 'employee' | 'floor';
  createdAt: string;
}

export interface AiExecutionResult {
  aiActionId: string;
  status: string;
  summary: string;
  affected: SeatingResult[];
  failures: Array<{ summary: string; message: string }>;
}

export interface AiAction {
  id: string;
  prompt: string;
  provider: string;
  model: string | null;
  action: string;
  kind: string;
  status: string;
  confidence: number | null;
  preview: AiPreview | null;
  result: unknown;
  errorMessage: string | null;
  createdAt: string;
  executedAt: string | null;
  user: { id: string; name: string } | null;
}

export interface AiStatus {
  provider: string;
  model: string;
  requiresApiKey: boolean;
  configured: boolean;
  description: string;
}

export interface GlobalSearchResult {
  query: string;
  employees: Employee[];
  seats: Seat[];
}
