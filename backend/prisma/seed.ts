/**
 * Seeds a realistic, fully populated SeatFlow instance.
 *
 * The data is deliberately shaped so the product demonstrates itself:
 *  - departments sit in clusters, so "find a seat near the engineering team"
 *    has a meaningful answer;
 *  - a few people share a first name, so the AI ambiguity path is reachable;
 *  - assignments are backdated across the last six weeks, so the occupancy
 *    trend chart has a real shape;
 *  - some seats are left available, reserved and disabled.
 *
 * Running it twice is safe: it truncates the seeded tables first.
 */
import { PrismaClient, type AreaType, type Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, '..', '.env') });
loadEnv({ path: path.resolve(here, '..', '..', '.env') });

const prisma = new PrismaClient();

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@seatflow.io';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'SeatFlow!2024';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Avery Collins';

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number, hour = 9): Date => {
  const date = new Date(Date.now() - days * DAY);
  date.setHours(hour, (days * 7) % 60, 0, 0);
  return date;
};

// ---------------------------------------------------------------- floor layout

interface ZoneSpec {
  zone: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
}

interface AreaSpec {
  name: string;
  type: AreaType;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FloorSpec {
  name: string;
  floorNumber: number;
  gridWidth: number;
  gridHeight: number;
  areas: AreaSpec[];
  zones: ZoneSpec[];
}

interface BuildingSpec {
  name: string;
  code: string;
  address: string;
  floors: FloorSpec[];
}

/**
 * Zone letters are unique across the entire company, which makes a seat code
 * such as "B-07" unambiguous without needing a floor prefix.
 */
const BUILDINGS: BuildingSpec[] = [
  {
    name: 'Orion HQ',
    code: 'ORN',
    address: '18 Riverside Avenue, Bengaluru 560103',
    floors: [
      {
        name: 'Floor 1',
        floorNumber: 1,
        gridWidth: 26,
        gridHeight: 16,
        areas: [
          { name: 'Reception', type: 'RECEPTION', x: 0, y: 0, width: 6, height: 4 },
          { name: 'Aurora Meeting Room', type: 'MEETING_ROOM', x: 0, y: 5, width: 6, height: 5 },
          { name: 'Break Room', type: 'BREAK_ROOM', x: 0, y: 11, width: 6, height: 5 },
          { name: 'Open Workspace', type: 'OPEN_WORKSPACE', x: 7, y: 0, width: 18, height: 16 },
        ],
        zones: [
          { zone: 'A', x: 9, y: 2, cols: 6, rows: 2 },
          { zone: 'B', x: 9, y: 7, cols: 4, rows: 2 },
          { zone: 'C', x: 9, y: 12, cols: 3, rows: 2 },
        ],
      },
      {
        name: 'Floor 2',
        floorNumber: 2,
        gridWidth: 26,
        gridHeight: 16,
        areas: [
          { name: 'Vega Meeting Room', type: 'MEETING_ROOM', x: 0, y: 0, width: 6, height: 5 },
          { name: 'Phone Booths', type: 'PHONE_BOOTH', x: 0, y: 6, width: 3, height: 4 },
          { name: 'Print & Supplies', type: 'UTILITY', x: 0, y: 11, width: 6, height: 4 },
          { name: 'Open Workspace', type: 'OPEN_WORKSPACE', x: 7, y: 0, width: 18, height: 16 },
        ],
        zones: [
          { zone: 'D', x: 9, y: 2, cols: 4, rows: 2 },
          { zone: 'E', x: 9, y: 8, cols: 3, rows: 2 },
        ],
      },
      {
        name: 'Floor 3',
        floorNumber: 3,
        gridWidth: 26,
        gridHeight: 16,
        areas: [
          { name: 'Lyra Meeting Room', type: 'MEETING_ROOM', x: 0, y: 0, width: 6, height: 5 },
          { name: 'Quiet Lounge', type: 'BREAK_ROOM', x: 0, y: 7, width: 6, height: 5 },
          { name: 'Open Workspace', type: 'OPEN_WORKSPACE', x: 7, y: 0, width: 18, height: 16 },
        ],
        zones: [
          { zone: 'G', x: 9, y: 2, cols: 3, rows: 2 },
          { zone: 'H', x: 9, y: 8, cols: 2, rows: 2 },
        ],
      },
    ],
  },
  {
    name: 'Nova Annex',
    code: 'NVA',
    address: '4 Lakeview Road, Bengaluru 560066',
    floors: [
      {
        name: 'Floor 1',
        floorNumber: 1,
        gridWidth: 22,
        gridHeight: 14,
        areas: [
          { name: 'Reception', type: 'RECEPTION', x: 0, y: 0, width: 5, height: 4 },
          { name: 'Orion Meeting Room', type: 'MEETING_ROOM', x: 0, y: 5, width: 5, height: 5 },
          { name: 'Open Workspace', type: 'OPEN_WORKSPACE', x: 6, y: 0, width: 15, height: 14 },
        ],
        zones: [
          { zone: 'J', x: 8, y: 2, cols: 3, rows: 2 },
          { zone: 'K', x: 8, y: 8, cols: 2, rows: 2 },
        ],
      },
      {
        name: 'Floor 2',
        floorNumber: 2,
        gridWidth: 22,
        gridHeight: 14,
        areas: [
          { name: 'Break Room', type: 'BREAK_ROOM', x: 0, y: 0, width: 5, height: 5 },
          { name: 'Phone Booth', type: 'PHONE_BOOTH', x: 0, y: 6, width: 3, height: 3 },
          { name: 'Open Workspace', type: 'OPEN_WORKSPACE', x: 6, y: 0, width: 15, height: 14 },
        ],
        zones: [
          { zone: 'L', x: 8, y: 2, cols: 3, rows: 2 },
          { zone: 'M', x: 8, y: 8, cols: 2, rows: 1 },
        ],
      },
    ],
  },
];

// ------------------------------------------------------------------- employees

interface EmployeeSpec {
  name: string;
  department: string;
  jobTitle: string;
  /** Exact seat to occupy. Omit to auto-place in the department's zones. */
  seat?: string;
  /** Explicitly leave this person without a seat. */
  unseated?: boolean;
  status?: 'ACTIVE' | 'ON_LEAVE' | 'INACTIVE';
}

/** Departments are clustered into zones so proximity questions have answers. */
const DEPARTMENT_ZONES: Record<string, string[]> = {
  Engineering: ['A', 'B'],
  Product: ['C'],
  Design: ['D'],
  Marketing: ['E'],
  Finance: ['G'],
  HR: ['H'],
  Operations: ['J', 'K'],
};

const EMPLOYEES: EmployeeSpec[] = [
  // Engineering (12) — zones A and B
  { name: 'Rahul Sharma', department: 'Engineering', jobTitle: 'Staff Engineer', seat: 'A-03' },
  { name: 'Priya Singh', department: 'Engineering', jobTitle: 'Senior Backend Engineer', seat: 'A-12' },
  { name: 'Arjun Mehta', department: 'Engineering', jobTitle: 'Platform Engineer', seat: 'A-01' },
  { name: 'Arjun Mehta', department: 'Operations', jobTitle: 'Facilities Coordinator', seat: 'J-02' },
  { name: 'Chen Wei', department: 'Engineering', jobTitle: 'Frontend Engineer', seat: 'A-02' },
  { name: 'Fatima Khan', department: 'Engineering', jobTitle: 'Engineering Manager', seat: 'A-04' },
  { name: 'Diego Alvarez', department: 'Engineering', jobTitle: 'Site Reliability Engineer', seat: 'A-05' },
  { name: 'Nina Kowalski', department: 'Engineering', jobTitle: 'Backend Engineer', seat: 'A-06' },
  { name: 'Samuel Osei', department: 'Engineering', jobTitle: 'Data Engineer', seat: 'A-07' },
  { name: 'Yuki Tanaka', department: 'Engineering', jobTitle: 'QA Engineer', seat: 'A-08' },
  { name: 'Mateo Rossi', department: 'Engineering', jobTitle: 'Mobile Engineer', seat: 'B-01' },
  { name: 'Aisha Bello', department: 'Engineering', jobTitle: 'Security Engineer', seat: 'B-02' },
  { name: 'Tomas Novak', department: 'Engineering', jobTitle: 'Junior Engineer', unseated: true },

  // Product (5) — zone C
  { name: 'Elena Petrova', department: 'Product', jobTitle: 'Head of Product' },
  { name: 'Marcus Bennett', department: 'Product', jobTitle: 'Senior Product Manager' },
  { name: 'Ishita Rao', department: 'Product', jobTitle: 'Product Manager' },
  { name: 'Kwame Asante', department: 'Product', jobTitle: 'Technical Product Manager' },
  { name: 'Lucia Ferreira', department: 'Product', jobTitle: 'Product Analyst' },

  // Design (4) — zone D
  { name: 'Noor Haddad', department: 'Design', jobTitle: 'Design Lead' },
  { name: 'Oliver Grant', department: 'Design', jobTitle: 'Product Designer' },
  { name: 'Sana Iqbal', department: 'Design', jobTitle: 'UX Researcher' },
  { name: 'Felix Braun', department: 'Design', jobTitle: 'Brand Designer' },

  // Marketing (5) — zone E, two deliberately unseated
  { name: 'Priya Nair', department: 'Marketing', jobTitle: 'Marketing Director' },
  { name: 'Jonas Lindqvist', department: 'Marketing', jobTitle: 'Content Strategist' },
  { name: 'Camille Dubois', department: 'Marketing', jobTitle: 'Campaign Manager' },
  { name: 'Rohan Kapoor', department: 'Marketing', jobTitle: 'Growth Marketer', unseated: true },
  { name: 'Grace O’Sullivan', department: 'Marketing', jobTitle: 'Events Manager', unseated: true },

  // Finance (4) — zone G
  { name: 'Hiroshi Sato', department: 'Finance', jobTitle: 'Finance Director' },
  { name: 'Amara Nwosu', department: 'Finance', jobTitle: 'Financial Analyst' },
  { name: 'Peter Zielinski', department: 'Finance', jobTitle: 'Accountant' },
  { name: 'Leila Amrani', department: 'Finance', jobTitle: 'Payroll Specialist' },

  // HR (3) — zone H
  { name: 'Sofia Marchetti', department: 'HR', jobTitle: 'Head of People' },
  { name: 'Daniel Okafor', department: 'HR', jobTitle: 'Talent Partner', status: 'ON_LEAVE' },
  { name: 'Mei Ling Chua', department: 'HR', jobTitle: 'People Operations' },

  // Operations (5) — zones J and K
  { name: 'Victor Hugo Silva', department: 'Operations', jobTitle: 'Head of Operations' },
  { name: 'Anika Sharma', department: 'Operations', jobTitle: 'Workplace Manager' },
  { name: 'Ben Carter', department: 'Operations', jobTitle: 'IT Support Lead' },
  { name: 'Zara Ahmed', department: 'Operations', jobTitle: 'Office Administrator' },
];

/** Seats intentionally left in a non-default state. */
const RESERVED_SEATS = ['B-05', 'C-04', 'L-03', 'E-06'];
const DISABLED_SEATS = ['B-08', 'M-02', 'K-04'];

const DISABLED_NOTES: Record<string, string> = {
  'B-08': 'Monitor arm broken - replacement ordered',
  'M-02': 'Under the air-conditioning vent, reported as too cold',
  'K-04': 'Reserved for cabling works until the network refresh completes',
};

// ------------------------------------------------------------------- utilities

function slugEmail(name: string, taken: Set<string>): string {
  const base = name
    .toLowerCase()
    // NFD splits accented letters into base + combining mark; the filter below
    // then drops the marks along with apostrophes and punctuation.
    .normalize('NFD')
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.');

  let email = base + '@seatflow.io';
  let suffix = 2;
  while (taken.has(email)) {
    email = base + suffix + '@seatflow.io';
    suffix += 1;
  }
  taken.add(email);
  return email;
}

async function reset(): Promise<void> {
  // Order matters: children before parents.
  await prisma.auditLog.deleteMany();
  await prisma.aIAction.deleteMany();
  await prisma.seatAssignment.deleteMany();
  await prisma.seat.deleteMany();
  await prisma.floorArea.deleteMany();
  await prisma.floor.deleteMany();
  await prisma.building.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.user.deleteMany();
}

// ------------------------------------------------------------------------ main

async function main(): Promise<void> {
  console.log('Resetting existing data...');
  await reset();

  // --- admin + a second operator ------------------------------------------
  const [adminHash, managerHash] = await Promise.all([
    bcrypt.hash(ADMIN_PASSWORD, 12),
    bcrypt.hash('Workplace!2024', 12),
  ]);

  const admin = await prisma.user.create({
    data: {
      name: ADMIN_NAME,
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash: adminHash,
      role: 'ADMIN',
    },
  });

  await prisma.user.create({
    data: {
      name: 'Jordan Blake',
      email: 'workplace@seatflow.io',
      passwordHash: managerHash,
      role: 'MANAGER',
    },
  });

  // --- buildings, floors, areas, seats -------------------------------------
  const seatIdByCode = new Map<string, string>();
  const floorIdByCode = new Map<string, string>();
  let seatTotal = 0;

  for (const buildingSpec of BUILDINGS) {
    const building = await prisma.building.create({
      data: { name: buildingSpec.name, code: buildingSpec.code, address: buildingSpec.address },
    });

    for (const floorSpec of buildingSpec.floors) {
      const floor = await prisma.floor.create({
        data: {
          buildingId: building.id,
          name: floorSpec.name,
          floorNumber: floorSpec.floorNumber,
          gridWidth: floorSpec.gridWidth,
          gridHeight: floorSpec.gridHeight,
          areas: {
            create: floorSpec.areas.map((area) => ({
              name: area.name,
              type: area.type,
              x: area.x,
              y: area.y,
              width: area.width,
              height: area.height,
            })),
          },
        },
      });
      floorIdByCode.set(building.code + '-' + floorSpec.floorNumber, floor.id);

      const seatRows: Prisma.SeatCreateManyInput[] = [];
      for (const zone of floorSpec.zones) {
        let index = 1;
        for (let row = 0; row < zone.rows; row += 1) {
          for (let col = 0; col < zone.cols; col += 1) {
            const seatCode = zone.zone + '-' + String(index).padStart(2, '0');
            seatRows.push({
              floorId: floor.id,
              seatCode,
              zone: zone.zone,
              // Two columns of desks share a spine, so a gap every second column
              // reads as a real bank of desks rather than a plain grid.
              xPosition: zone.x + col * 2,
              yPosition: zone.y + row * 2,
              status: 'AVAILABLE',
              notes: DISABLED_NOTES[seatCode] ?? null,
            });
            index += 1;
          }
        }
      }

      await prisma.seat.createMany({ data: seatRows });
      seatTotal += seatRows.length;

      const created = await prisma.seat.findMany({
        where: { floorId: floor.id },
        select: { id: true, seatCode: true },
      });
      for (const seat of created) seatIdByCode.set(seat.seatCode, seat.id);
    }
  }

  console.log(
    'Created ' +
      BUILDINGS.length +
      ' buildings, ' +
      BUILDINGS.reduce((sum, b) => sum + b.floors.length, 0) +
      ' floors and ' +
      seatTotal +
      ' seats.',
  );

  // --- employees ------------------------------------------------------------
  const emails = new Set<string>();
  const employeeRecords: Array<{ id: string; name: string; department: string; spec: EmployeeSpec }> = [];

  for (const [index, spec] of EMPLOYEES.entries()) {
    const employee = await prisma.employee.create({
      data: {
        employeeCode: 'EMP-' + String(index + 1).padStart(4, '0'),
        name: spec.name,
        email: slugEmail(spec.name, emails),
        department: spec.department,
        jobTitle: spec.jobTitle,
        status: spec.status ?? 'ACTIVE',
        createdAt: daysAgo(120 - index),
      },
    });
    employeeRecords.push({ id: employee.id, name: employee.name, department: employee.department, spec });
  }

  console.log('Created ' + employeeRecords.length + ' employees.');

  // --- seat assignments -----------------------------------------------------
  const usedSeats = new Set<string>([...RESERVED_SEATS, ...DISABLED_SEATS]);
  for (const record of employeeRecords) {
    if (record.spec.seat) usedSeats.add(record.spec.seat);
  }

  /** Next free seat inside the department's cluster. */
  function nextSeatFor(department: string): string | null {
    const zones = DEPARTMENT_ZONES[department] ?? [];
    for (const zone of zones) {
      const codes = [...seatIdByCode.keys()]
        .filter((code) => code.startsWith(zone + '-'))
        .sort();
      for (const code of codes) {
        if (!usedSeats.has(code)) {
          usedSeats.add(code);
          return code;
        }
      }
    }
    return null;
  }

  const assignments: Array<{ employeeId: string; seatCode: string; assignedAt: Date; name: string }> = [];

  for (const [index, record] of employeeRecords.entries()) {
    if (record.spec.unseated) continue;
    const seatCode = record.spec.seat ?? nextSeatFor(record.department);
    if (!seatCode) continue;
    assignments.push({
      employeeId: record.id,
      seatCode,
      // Spread across the last six weeks so the trend chart is not a flat line.
      assignedAt: daysAgo(42 - Math.floor((index * 42) / employeeRecords.length), 9 + (index % 6)),
      name: record.name,
    });
  }

  for (const assignment of assignments) {
    const seatId = seatIdByCode.get(assignment.seatCode);
    if (!seatId) continue;
    await prisma.seatAssignment.create({
      data: {
        employeeId: assignment.employeeId,
        seatId,
        active: true,
        assignedAt: assignment.assignedAt,
        assignedBy: admin.id,
      },
    });
    await prisma.seat.update({ where: { id: seatId }, data: { status: 'OCCUPIED' } });
  }

  // --- historical (released) assignments, so profiles have a real history ---
  const historySource = assignments.slice(0, 6);
  for (const [index, assignment] of historySource.entries()) {
    const oldSeatCode = ['C-05', 'L-01', 'L-02', 'M-01', 'K-03', 'J-06'][index];
    const oldSeatId = oldSeatCode ? seatIdByCode.get(oldSeatCode) : undefined;
    if (!oldSeatId) continue;
    const assignedAt = new Date(assignment.assignedAt.getTime() - 30 * DAY);
    await prisma.seatAssignment.create({
      data: {
        employeeId: assignment.employeeId,
        seatId: oldSeatId,
        active: null,
        assignedAt,
        releasedAt: assignment.assignedAt,
        assignedBy: admin.id,
      },
    });
  }

  // --- reserved / disabled seats -------------------------------------------
  await prisma.seat.updateMany({
    where: { seatCode: { in: RESERVED_SEATS } },
    data: { status: 'RESERVED' },
  });
  await prisma.seat.updateMany({
    where: { seatCode: { in: DISABLED_SEATS } },
    data: { status: 'DISABLED' },
  });

  // --- audit trail ----------------------------------------------------------
  const auditRows: Prisma.AuditLogCreateManyInput[] = assignments.map((assignment) => ({
    action: 'EMPLOYEE_ASSIGNED',
    source: 'MANUAL',
    status: 'SUCCESS',
    userId: admin.id,
    employeeId: assignment.employeeId,
    newSeatId: seatIdByCode.get(assignment.seatCode) ?? null,
    summary: assignment.name + ' assigned to seat ' + assignment.seatCode,
    metadata: { seatCode: assignment.seatCode, seededRecord: true },
    createdAt: assignment.assignedAt,
  }));

  for (const seatCode of DISABLED_SEATS) {
    auditRows.push({
      action: 'SEAT_DISABLED',
      source: 'MANUAL',
      status: 'SUCCESS',
      userId: admin.id,
      previousSeatId: seatIdByCode.get(seatCode) ?? null,
      newSeatId: seatIdByCode.get(seatCode) ?? null,
      summary: 'Seat ' + seatCode + ' disabled',
      metadata: { seatCode, reason: DISABLED_NOTES[seatCode] ?? 'Out of service' },
      createdAt: daysAgo(9),
    });
  }

  for (const seatCode of RESERVED_SEATS) {
    auditRows.push({
      action: 'SEAT_RESERVED',
      source: 'MANUAL',
      status: 'SUCCESS',
      userId: admin.id,
      previousSeatId: seatIdByCode.get(seatCode) ?? null,
      newSeatId: seatIdByCode.get(seatCode) ?? null,
      summary: 'Seat ' + seatCode + ' reserved',
      metadata: { seatCode, reason: 'Held for an incoming hire' },
      createdAt: daysAgo(6),
    });
  }

  await prisma.auditLog.createMany({ data: auditRows });

  // --- a little AI history so the assistant page is not empty ---------------
  await prisma.aIAction.createMany({
    data: [
      {
        userId: admin.id,
        prompt: 'How many seats are occupied on Floor 1?',
        provider: 'local',
        model: 'seatflow-rule-interpreter',
        parsedAction: { action: 'QUERY_OCCUPANCY', kind: 'answer', command: null },
        status: 'ANSWERED',
        confidence: 0.92,
        result: { text: 'Occupancy reported for Floor 1.' },
        createdAt: daysAgo(3, 10),
      },
      {
        userId: admin.id,
        prompt: 'Which seats are available on Floor 2?',
        provider: 'local',
        model: 'seatflow-rule-interpreter',
        parsedAction: { action: 'QUERY_AVAILABLE_SEATS', kind: 'answer', command: null },
        status: 'ANSWERED',
        confidence: 0.92,
        result: { text: 'Listed the available seats on Floor 2.' },
        createdAt: daysAgo(2, 15),
      },
      {
        userId: admin.id,
        prompt: 'Move Tomas Novak to seat Z-99',
        provider: 'local',
        model: 'seatflow-rule-interpreter',
        parsedAction: { action: 'MOVE_EMPLOYEE', kind: 'rejected', command: null },
        status: 'REJECTED',
        confidence: 0.94,
        errorMessage: 'There is no seat with the code "Z-99".',
        createdAt: daysAgo(1, 11),
      },
    ],
  });

  // --- summary --------------------------------------------------------------
  const [seatCount, occupied, available, reserved, disabled, employeeCount] = await Promise.all([
    prisma.seat.count(),
    prisma.seat.count({ where: { status: 'OCCUPIED' } }),
    prisma.seat.count({ where: { status: 'AVAILABLE' } }),
    prisma.seat.count({ where: { status: 'RESERVED' } }),
    prisma.seat.count({ where: { status: 'DISABLED' } }),
    prisma.employee.count(),
  ]);

  console.log('');
  console.log('Seed complete');
  console.log('  Employees          ' + employeeCount);
  console.log('  Seats              ' + seatCount);
  console.log('    occupied         ' + occupied);
  console.log('    available        ' + available);
  console.log('    reserved         ' + reserved);
  console.log('    disabled         ' + disabled);
  console.log('  Occupancy          ' + Math.round((occupied / (seatCount - disabled)) * 100) + '%');
  console.log('');
  console.log('  Admin sign-in      ' + ADMIN_EMAIL + ' / ' + ADMIN_PASSWORD);
  console.log('  Manager sign-in    workplace@seatflow.io / Workplace!2024');
  console.log('');
}

main()
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
