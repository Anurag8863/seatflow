import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import type { AiContext, AiProvider } from './types.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createGroqProvider } from './providers/groq.js';
import { createLocalProvider } from './providers/local.js';

let cached: AiProvider | null = null;

export function getAiProvider(): AiProvider {
  if (cached) return cached;

  switch (env.AI_PROVIDER) {
    case 'gemini':
      cached = createGeminiProvider();
      break;
    case 'groq':
      cached = createGroqProvider();
      break;
    default:
      cached = createLocalProvider();
  }
  return cached;
}

/** Test seam — lets the suite swap in a stub provider. */
export function setAiProvider(provider: AiProvider | null): void {
  cached = provider;
}

export function describeProvider(): { provider: string; model: string; requiresApiKey: boolean } {
  const provider = getAiProvider();
  return {
    provider: provider.name,
    model: provider.model,
    requiresApiKey: provider.name !== 'local',
  };
}

/**
 * Builds the office-shape context handed to the model. Deliberately excludes the
 * employee directory: personal data never leaves the server for a third-party
 * model, and names are matched against the database during resolution instead.
 */
export async function buildAiContext(): Promise<AiContext> {
  const [buildings, departments, sampleSeat] = await Promise.all([
    prisma.building.findMany({
      orderBy: { name: 'asc' },
      include: {
        floors: {
          orderBy: { floorNumber: 'asc' },
          include: { seats: { select: { zone: true }, distinct: ['zone'], orderBy: { zone: 'asc' } } },
        },
      },
    }),
    prisma.employee.groupBy({ by: ['department'], orderBy: { department: 'asc' } }),
    prisma.seat.findFirst({ orderBy: { seatCode: 'asc' }, select: { seatCode: true } }),
  ]);

  return {
    buildings: buildings.map((building) => ({
      name: building.name,
      code: building.code,
      floors: building.floors.map((floor) => ({
        name: floor.name,
        floorNumber: floor.floorNumber,
        zones: floor.seats.map((seat) => seat.zone),
      })),
    })),
    departments: departments.map((row) => row.department),
    seatCodeExample: sampleSeat?.seatCode ?? 'A-01',
  };
}
