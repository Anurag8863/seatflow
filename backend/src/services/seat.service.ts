import { Prisma, type SeatStatus } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { NotFoundError } from '../lib/errors.js';
import { seatInclude, serializeSeat, type SeatDto } from './serializers.js';

export type SeatSort = 'seatCode' | 'zone' | 'status' | 'updatedAt';

export interface ListSeatsParams {
  search?: string;
  buildingId?: string;
  floorId?: string;
  zone?: string;
  status?: SeatStatus;
  department?: string;
  page: number;
  pageSize: number;
  sortBy: SeatSort;
  sortDir: 'asc' | 'desc';
}

export function buildSeatWhere(params: Partial<ListSeatsParams>): Prisma.SeatWhereInput {
  const and: Prisma.SeatWhereInput[] = [];

  if (params.search) {
    const term = params.search.trim();
    if (term) {
      and.push({
        OR: [
          { seatCode: { contains: term, mode: 'insensitive' } },
          { zone: { contains: term, mode: 'insensitive' } },
          { floor: { name: { contains: term, mode: 'insensitive' } } },
          { floor: { building: { name: { contains: term, mode: 'insensitive' } } } },
          {
            assignments: {
              some: { active: true, employee: { name: { contains: term, mode: 'insensitive' } } },
            },
          },
          {
            assignments: {
              some: { active: true, employee: { employeeCode: { contains: term, mode: 'insensitive' } } },
            },
          },
        ],
      });
    }
  }
  if (params.floorId) and.push({ floorId: params.floorId });
  if (params.buildingId) and.push({ floor: { buildingId: params.buildingId } });
  if (params.zone) and.push({ zone: params.zone });
  if (params.status) and.push({ status: params.status });
  if (params.department) {
    and.push({
      assignments: { some: { active: true, employee: { department: params.department } } },
    });
  }

  return and.length ? { AND: and } : {};
}

export async function listSeats(
  params: ListSeatsParams,
): Promise<{ items: SeatDto[]; total: number }> {
  const where = buildSeatWhere(params);
  const orderBy: Prisma.SeatOrderByWithRelationInput = { [params.sortBy]: params.sortDir };

  const [total, rows] = await Promise.all([
    prisma.seat.count({ where }),
    prisma.seat.findMany({
      where,
      orderBy,
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: seatInclude,
    }),
  ]);

  return { items: rows.map(serializeSeat), total };
}

export async function getSeat(seatId: string): Promise<SeatDto> {
  const seat = await prisma.seat.findUnique({ where: { id: seatId }, include: seatInclude });
  if (!seat) throw new NotFoundError('We could not find that seat.');
  return serializeSeat(seat);
}

export async function listZones(floorId?: string): Promise<string[]> {
  const grouped = await prisma.seat.groupBy({
    by: ['zone'],
    where: floorId ? { floorId } : undefined,
    orderBy: { zone: 'asc' },
  });
  return grouped.map((row) => row.zone);
}

export interface FloorAreaDto {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FloorPlanDto {
  floor: {
    id: string;
    name: string;
    floorNumber: number;
    gridWidth: number;
    gridHeight: number;
    building: { id: string; name: string; code: string; address: string };
  };
  areas: FloorAreaDto[];
  seats: SeatDto[];
  stats: {
    total: number;
    occupied: number;
    available: number;
    reserved: number;
    disabled: number;
    occupancyRate: number;
  };
}

/**
 * Everything the seating plan needs for one floor in a single round trip:
 * geometry, background areas, seats with their occupants, and floor-level stats.
 */
export async function getFloorPlan(floorId: string): Promise<FloorPlanDto> {
  const floor = await prisma.floor.findUnique({
    where: { id: floorId },
    include: {
      building: true,
      areas: { orderBy: { name: 'asc' } },
      seats: { include: seatInclude, orderBy: { seatCode: 'asc' } },
    },
  });
  if (!floor) throw new NotFoundError('We could not find that floor.');

  const seats = floor.seats.map(serializeSeat);
  const counts = { OCCUPIED: 0, AVAILABLE: 0, RESERVED: 0, DISABLED: 0 } as Record<string, number>;
  for (const seat of seats) counts[seat.status] = (counts[seat.status] ?? 0) + 1;

  const assignable = seats.length - (counts.DISABLED ?? 0);

  return {
    floor: {
      id: floor.id,
      name: floor.name,
      floorNumber: floor.floorNumber,
      gridWidth: floor.gridWidth,
      gridHeight: floor.gridHeight,
      building: {
        id: floor.building.id,
        name: floor.building.name,
        code: floor.building.code,
        address: floor.building.address,
      },
    },
    areas: floor.areas.map((area) => ({
      id: area.id,
      name: area.name,
      type: area.type,
      x: area.x,
      y: area.y,
      width: area.width,
      height: area.height,
    })),
    seats,
    stats: {
      total: seats.length,
      occupied: counts.OCCUPIED ?? 0,
      available: counts.AVAILABLE ?? 0,
      reserved: counts.RESERVED ?? 0,
      disabled: counts.DISABLED ?? 0,
      occupancyRate: assignable > 0 ? Math.round(((counts.OCCUPIED ?? 0) / assignable) * 100) : 0,
    },
  };
}

export interface BuildingDto {
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

export async function listBuildings(): Promise<BuildingDto[]> {
  const buildings = await prisma.building.findMany({
    orderBy: { name: 'asc' },
    include: {
      floors: {
        orderBy: { floorNumber: 'asc' },
        include: {
          _count: { select: { seats: true } },
          seats: { where: { status: 'OCCUPIED' }, select: { id: true } },
        },
      },
    },
  });

  return buildings.map((building) => ({
    id: building.id,
    name: building.name,
    code: building.code,
    address: building.address,
    floors: building.floors.map((floor) => ({
      id: floor.id,
      name: floor.name,
      floorNumber: floor.floorNumber,
      seatCount: floor._count.seats,
      occupiedCount: floor.seats.length,
    })),
  }));
}
