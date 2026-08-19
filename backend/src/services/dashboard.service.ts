import { prisma } from '../db/prisma.js';
import { auditLogInclude, serializeAuditLog, type AuditLogDto } from './serializers.js';

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
  seatBreakdown: Array<{ status: string; label: string; count: number }>;
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
  recentActivity: AuditLogDto[];
  recentAiActions: Array<{
    id: string;
    prompt: string;
    action: string;
    status: string;
    createdAt: string;
    userName: string | null;
  }>;
}

const STATUS_LABELS: Record<string, string> = {
  OCCUPIED: 'Occupied',
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  DISABLED: 'Disabled',
};

/**
 * Rebuilds a 14-day occupancy history from the assignment ledger. An assignment
 * counts towards a day when it started on or before that day and had not been
 * released by the end of it.
 */
function buildOccupancyTrend(
  assignments: Array<{ assignedAt: Date; releasedAt: Date | null }>,
  days = 14,
): Array<{ date: string; occupied: number }> {
  const trend: Array<{ date: string; occupied: number }> = [];
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const dayEnd = new Date(today);
    dayEnd.setDate(today.getDate() - offset);
    const occupied = assignments.filter(
      (assignment) =>
        assignment.assignedAt <= dayEnd && (!assignment.releasedAt || assignment.releasedAt > dayEnd),
    ).length;
    trend.push({ date: dayEnd.toISOString().slice(0, 10), occupied });
  }
  return trend;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [
    employeeCount,
    activeEmployeeCount,
    assignedEmployeeCount,
    seatStatusGroups,
    buildingCount,
    floorCount,
    departmentGroups,
    seatedDepartmentGroups,
    floors,
    assignments,
    recentLogs,
    recentAi,
  ] = await Promise.all([
    prisma.employee.count(),
    prisma.employee.count({ where: { status: 'ACTIVE' } }),
    prisma.employee.count({ where: { assignments: { some: { active: true } } } }),
    prisma.seat.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.building.count(),
    prisma.floor.count(),
    prisma.employee.groupBy({ by: ['department'], _count: { _all: true }, orderBy: { department: 'asc' } }),
    prisma.employee.groupBy({
      by: ['department'],
      where: { assignments: { some: { active: true } } },
      _count: { _all: true },
    }),
    prisma.floor.findMany({
      orderBy: [{ buildingId: 'asc' }, { floorNumber: 'asc' }],
      include: {
        building: { select: { name: true } },
        seats: { select: { status: true } },
      },
    }),
    prisma.seatAssignment.findMany({ select: { assignedAt: true, releasedAt: true } }),
    prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 8, include: auditLogInclude }),
    prisma.aIAction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const seatCounts: Record<string, number> = {};
  for (const group of seatStatusGroups) seatCounts[group.status] = group._count._all;

  const totalSeats = Object.values(seatCounts).reduce((sum, count) => sum + count, 0);
  const occupiedSeats = seatCounts.OCCUPIED ?? 0;
  const disabledSeats = seatCounts.DISABLED ?? 0;
  const assignableSeats = totalSeats - disabledSeats;

  const seatedByDepartment = new Map(
    seatedDepartmentGroups.map((group) => [group.department, group._count._all]),
  );

  return {
    totals: {
      employees: employeeCount,
      activeEmployees: activeEmployeeCount,
      assignedEmployees: assignedEmployeeCount,
      unassignedEmployees: employeeCount - assignedEmployeeCount,
      seats: totalSeats,
      occupiedSeats,
      availableSeats: seatCounts.AVAILABLE ?? 0,
      reservedSeats: seatCounts.RESERVED ?? 0,
      disabledSeats,
      // Disabled seats are excluded from the denominator: they are not usable
      // capacity, so counting them would understate real utilisation.
      occupancyRate: assignableSeats > 0 ? Math.round((occupiedSeats / assignableSeats) * 100) : 0,
      buildings: buildingCount,
      floors: floorCount,
    },
    seatBreakdown: ['OCCUPIED', 'AVAILABLE', 'RESERVED', 'DISABLED'].map((status) => ({
      status,
      label: STATUS_LABELS[status] ?? status,
      count: seatCounts[status] ?? 0,
    })),
    departmentDistribution: departmentGroups.map((group) => ({
      department: group.department,
      employees: group._count._all,
      seated: seatedByDepartment.get(group.department) ?? 0,
    })),
    floorOccupancy: floors.map((floor) => {
      const total = floor.seats.length;
      const occupied = floor.seats.filter((seat) => seat.status === 'OCCUPIED').length;
      const available = floor.seats.filter((seat) => seat.status === 'AVAILABLE').length;
      const usable = total - floor.seats.filter((seat) => seat.status === 'DISABLED').length;
      return {
        floorId: floor.id,
        floorName: floor.name,
        buildingName: floor.building.name,
        total,
        occupied,
        available,
        occupancyRate: usable > 0 ? Math.round((occupied / usable) * 100) : 0,
      };
    }),
    occupancyTrend: buildOccupancyTrend(assignments),
    recentActivity: recentLogs.map(serializeAuditLog),
    recentAiActions: recentAi.map((action) => {
      const parsed = action.parsedAction as { action?: string } | null;
      return {
        id: action.id,
        prompt: action.prompt,
        action: parsed?.action ?? 'UNKNOWN',
        status: action.status,
        createdAt: action.createdAt.toISOString(),
        userName: action.user?.name ?? null,
      };
    }),
  };
}
