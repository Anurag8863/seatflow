import { z } from 'zod';

/**
 * The *intent* schema — the only thing a language model is ever allowed to
 * produce. Note what is absent: no SQL, no table names, no database IDs. The
 * model returns human-level references ("Rahul Sharma", "A-12") and the
 * resolver in `resolver.ts` turns those into real primary keys after checking
 * them against the database. A hallucinated name therefore fails resolution
 * instead of touching data.
 */
export const AI_ACTIONS = [
  'MOVE_EMPLOYEE',
  'ASSIGN_EMPLOYEE',
  'RELEASE_SEAT',
  'BULK_MOVE_DEPARTMENT',
  'QUERY_AVAILABLE_SEATS',
  'QUERY_OCCUPANCY',
  'FIND_SEAT_NEAR_TEAM',
  'CLARIFICATION_NEEDED',
  'UNSUPPORTED',
] as const;

export type AiActionName = (typeof AI_ACTIONS)[number];

export const aiIntentSchema = z.object({
  action: z.enum(AI_ACTIONS),
  employeeQuery: z.string().trim().max(120).optional().nullable(),
  fromSeatCode: z.string().trim().max(32).optional().nullable(),
  toSeatCode: z.string().trim().max(32).optional().nullable(),
  seatCode: z.string().trim().max(32).optional().nullable(),
  department: z.string().trim().max(60).optional().nullable(),
  floorQuery: z.string().trim().max(60).optional().nullable(),
  buildingQuery: z.string().trim().max(60).optional().nullable(),
  zone: z.string().trim().max(16).optional().nullable(),
  onlyUnassigned: z.boolean().optional().nullable(),
  limit: z.number().int().min(1).max(50).optional().nullable(),
  reason: z.string().trim().max(280).optional().nullable(),
  clarification: z.string().trim().max(280).optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
});

export type AiIntent = z.infer<typeof aiIntentSchema>;

/**
 * The executable command. Produced only by the resolver, only from database
 * rows that were verified to exist and satisfy every seating rule.
 */
export type ExecutableCommand =
  | { type: 'ASSIGN_EMPLOYEE'; employeeId: string; seatId: string }
  | { type: 'MOVE_EMPLOYEE'; employeeId: string; toSeatId: string }
  | { type: 'RELEASE_SEAT'; seatId: string }
  | { type: 'BULK_MOVE'; moves: Array<{ employeeId: string; toSeatId: string }> };

export interface PreviewField {
  label: string;
  value: string;
  /** Renders as a subdued "before" value in the confirmation card. */
  muted?: boolean;
}

export interface PreviewRow {
  employeeName: string;
  department: string;
  fromSeatCode: string | null;
  toSeatCode: string | null;
}

export interface AiPreview {
  title: string;
  description: string;
  fields: PreviewField[];
  rows?: PreviewRow[];
  warnings?: string[];
}

export interface AiAmbiguityOption {
  id: string;
  label: string;
  description: string;
}

export type AiPlanKind = 'mutation' | 'answer' | 'clarification' | 'rejected';

export interface AiAnswerSeat {
  id: string;
  seatCode: string;
  zone: string;
  floorName: string;
  buildingName: string;
  status: string;
}

export interface AiAnswer {
  text: string;
  seats?: AiAnswerSeat[];
  stats?: Array<{ label: string; value: string }>;
}

/** What `/api/ai/interpret` returns to the browser. */
export interface AiPlan {
  aiActionId: string;
  kind: AiPlanKind;
  action: AiActionName;
  provider: string;
  model: string;
  confidence: number;
  reason: string | null;
  /** Present when kind === 'mutation'. Requires explicit admin confirmation. */
  preview?: AiPreview;
  /** Present when kind === 'answer'. Read-only, nothing to confirm. */
  answer?: AiAnswer;
  /** Present when kind === 'clarification' or 'rejected'. */
  message?: string;
  /** Choices offered when a reference matched more than one record. */
  options?: AiAmbiguityOption[];
  /** Tells the client which field to resend the chosen option in. */
  optionKind?: 'employee' | 'floor';
  createdAt: string;
}

export interface ResolvedPlan {
  kind: AiPlanKind;
  action: AiActionName;
  command?: ExecutableCommand;
  preview?: AiPreview;
  answer?: AiAnswer;
  message?: string;
  options?: AiAmbiguityOption[];
  optionKind?: 'employee' | 'floor';
  confidence: number;
  reason: string | null;
}

/** Compact, non-sensitive context handed to the language model. */
export interface AiContext {
  buildings: Array<{
    name: string;
    code: string;
    floors: Array<{ name: string; floorNumber: number; zones: string[] }>;
  }>;
  departments: string[];
  seatCodeExample: string;
}

export interface AiProviderResult {
  intent: AiIntent;
  provider: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  interpret(prompt: string, context: AiContext): Promise<AiIntent>;
}
