import { Prisma, type AiActionStatus } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { AppError, ConflictError, ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { moveEmployee, releaseSeat, type ActionContext } from '../seating.service.js';
import type { SeatDto, EmployeeDto } from '../serializers.js';
import { buildAiContext, getAiProvider } from './provider.js';
import { resolveIntent } from './resolver.js';
import type { AiPlan, AiPlanKind, ExecutableCommand, ResolvedPlan } from './types.js';

const STATUS_FOR_KIND: Record<AiPlanKind, AiActionStatus> = {
  mutation: 'PENDING',
  answer: 'ANSWERED',
  clarification: 'NEEDS_INPUT',
  rejected: 'REJECTED',
};

export interface InterpretInput {
  prompt: string;
  userId: string;
  selectedEmployeeId?: string | null;
  selectedFloorId?: string | null;
  /** The building open in the UI; disambiguates a bare "Floor 2". */
  scopeBuildingId?: string | null;
}

/**
 * Stage 1 of the AI pipeline: prompt -> structured intent -> validated plan.
 * Nothing is written to seating data here. A mutation plan is stored as PENDING
 * and only `executeAiAction` can act on it, after the admin confirms.
 */
export async function interpretPrompt(input: InterpretInput): Promise<AiPlan> {
  const provider = getAiProvider();
  const context = await buildAiContext();

  let plan: ResolvedPlan;
  try {
    const intent = await provider.interpret(input.prompt, context);
    plan = await resolveIntent(intent, {
      selectedEmployeeId: input.selectedEmployeeId ?? null,
      selectedFloorId: input.selectedFloorId ?? null,
      scopeBuildingId: input.scopeBuildingId ?? null,
    });
  } catch (error) {
    // Record the failed attempt so the history shows provider outages too.
    await prisma.aIAction
      .create({
        data: {
          userId: input.userId,
          prompt: input.prompt,
          provider: provider.name,
          model: provider.model,
          parsedAction: { action: 'UNSUPPORTED' } as Prisma.InputJsonValue,
          status: 'FAILED',
          errorMessage: error instanceof AppError ? error.message : 'The AI request could not be completed.',
        },
      })
      .catch((writeError: unknown) => {
        logger.error('Could not record failed AI action', {
          message: writeError instanceof Error ? writeError.message : String(writeError),
        });
      });
    throw error;
  }

  const record = await prisma.aIAction.create({
    data: {
      userId: input.userId,
      prompt: input.prompt,
      provider: provider.name,
      model: provider.model,
      parsedAction: {
        action: plan.action,
        kind: plan.kind,
        command: plan.command ?? null,
      } as Prisma.InputJsonValue,
      preview: (plan.preview ?? null) as unknown as Prisma.InputJsonValue,
      status: STATUS_FOR_KIND[plan.kind],
      confidence: plan.confidence,
      ...(plan.kind === 'answer' ? { result: (plan.answer ?? null) as unknown as Prisma.InputJsonValue } : {}),
      ...(plan.message ? { errorMessage: plan.message } : {}),
    },
  });

  return {
    aiActionId: record.id,
    kind: plan.kind,
    action: plan.action,
    provider: provider.name,
    model: provider.model,
    confidence: plan.confidence,
    reason: plan.reason,
    ...(plan.preview ? { preview: plan.preview } : {}),
    ...(plan.answer ? { answer: plan.answer } : {}),
    ...(plan.message ? { message: plan.message } : {}),
    ...(plan.options ? { options: plan.options } : {}),
    ...(plan.optionKind ? { optionKind: plan.optionKind } : {}),
    createdAt: record.createdAt.toISOString(),
  };
}

export interface ExecutionResult {
  aiActionId: string;
  status: AiActionStatus;
  summary: string;
  affected: Array<{
    employee: EmployeeDto | null;
    seat: SeatDto | null;
    previousSeat: SeatDto | null;
    summary: string;
  }>;
  failures: Array<{ summary: string; message: string }>;
}

function parseCommand(value: Prisma.JsonValue | null): ExecutableCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const command = (value as Record<string, unknown>).command;
  if (!command || typeof command !== 'object') return null;
  return command as ExecutableCommand;
}

async function runCommand(command: ExecutableCommand, ctx: ActionContext) {
  switch (command.type) {
    case 'MOVE_EMPLOYEE':
      return [await moveEmployee({ employeeId: command.employeeId, toSeatId: command.toSeatId }, ctx)];
    case 'ASSIGN_EMPLOYEE':
      return [await moveEmployee({ employeeId: command.employeeId, toSeatId: command.seatId }, ctx)];
    case 'RELEASE_SEAT':
      return [await releaseSeat({ seatId: command.seatId }, ctx)];
    default:
      throw new AppError(400, 'UNSUPPORTED_COMMAND', 'That AI command type cannot be executed.');
  }
}

/**
 * Stage 2: execute a plan the administrator explicitly confirmed.
 *
 * The stored command is re-run through the same seating service the manual UI
 * uses, so every invariant is re-checked against live data inside a transaction.
 * If the world changed since the preview (someone took the seat), execution
 * fails loudly rather than forcing the change through.
 */
export async function executeAiAction(aiActionId: string, userId: string): Promise<ExecutionResult> {
  const record = await prisma.aIAction.findUnique({ where: { id: aiActionId } });
  if (!record) throw new NotFoundError('That AI action no longer exists.');
  if (record.userId !== userId) {
    throw new ForbiddenError('You can only confirm AI actions you requested.');
  }
  if (record.status !== 'PENDING') {
    throw new ConflictError(
      'This AI action has already been ' + record.status.toLowerCase() + '.',
      'AI_ACTION_NOT_PENDING',
      { status: record.status },
    );
  }

  const command = parseCommand(record.parsedAction);
  if (!command) {
    throw new ConflictError('This AI action has nothing to execute.', 'AI_ACTION_NOT_EXECUTABLE');
  }

  const ctx: ActionContext = { actorId: userId, source: 'AI', aiActionId: record.id };
  const affected: ExecutionResult['affected'] = [];
  const failures: ExecutionResult['failures'] = [];

  try {
    if (command.type === 'BULK_MOVE') {
      for (const move of command.moves) {
        try {
          const result = await moveEmployee({ employeeId: move.employeeId, toSeatId: move.toSeatId }, ctx);
          affected.push(result);
        } catch (error) {
          const employee = await prisma.employee.findUnique({
            where: { id: move.employeeId },
            select: { name: true },
          });
          failures.push({
            summary: employee?.name ?? 'An employee',
            message: error instanceof AppError ? error.message : 'The move could not be completed.',
          });
        }
      }

      if (affected.length === 0) {
        const message = failures[0]?.message ?? 'None of the moves could be completed.';
        await prisma.aIAction.update({
          where: { id: record.id },
          data: { status: 'FAILED', errorMessage: message, executedAt: new Date() },
        });
        throw new ConflictError(message, 'AI_EXECUTION_FAILED', { failures });
      }

      // A bulk action produces many per-employee audit rows; one summary row
      // keeps the audit log readable at a glance.
      await prisma.auditLog.create({
        data: {
          action: 'AI_ACTION_EXECUTED',
          source: 'AI',
          status: failures.length ? 'FAILED' : 'SUCCESS',
          userId,
          summary:
            'AI bulk move completed: ' +
            affected.length +
            ' moved' +
            (failures.length ? ', ' + failures.length + ' skipped' : ''),
          metadata: {
            aiActionId: record.id,
            prompt: record.prompt,
            moved: affected.length,
            skipped: failures.length,
          },
        },
      });
    } else {
      const results = await runCommand(command, ctx);
      affected.push(...results);
    }
  } catch (error) {
    if (affected.length === 0) {
      await prisma.aIAction
        .update({
          where: { id: record.id },
          data: {
            status: 'FAILED',
            errorMessage: error instanceof AppError ? error.message : 'The action could not be completed.',
            executedAt: new Date(),
          },
        })
        .catch(() => undefined);
    }
    throw error;
  }

  const summary =
    affected.length === 1
      ? affected[0]!.summary
      : affected.length + ' seating changes applied' + (failures.length ? ', ' + failures.length + ' skipped' : '');

  await prisma.aIAction.update({
    where: { id: record.id },
    data: {
      status: 'EXECUTED',
      executedAt: new Date(),
      result: {
        summary,
        affected: affected.map((item) => ({
          employee: item.employee?.name ?? null,
          fromSeat: item.previousSeat?.seatCode ?? null,
          toSeat: item.seat?.seatCode ?? null,
        })),
        failures,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { aiActionId: record.id, status: 'EXECUTED', summary, affected, failures };
}

export async function cancelAiAction(aiActionId: string, userId: string): Promise<{ id: string; status: string }> {
  const record = await prisma.aIAction.findUnique({ where: { id: aiActionId } });
  if (!record) throw new NotFoundError('That AI action no longer exists.');
  if (record.userId !== userId) {
    throw new ForbiddenError('You can only cancel AI actions you requested.');
  }
  if (record.status !== 'PENDING') {
    throw new ConflictError(
      'This AI action has already been ' + record.status.toLowerCase() + '.',
      'AI_ACTION_NOT_PENDING',
    );
  }

  const updated = await prisma.aIAction.update({
    where: { id: record.id },
    data: { status: 'CANCELLED' },
  });
  return { id: updated.id, status: updated.status };
}

export interface AiActionDto {
  id: string;
  prompt: string;
  provider: string;
  model: string | null;
  action: string;
  kind: string;
  status: string;
  confidence: number | null;
  preview: unknown;
  result: unknown;
  errorMessage: string | null;
  createdAt: string;
  executedAt: string | null;
  user: { id: string; name: string } | null;
}

function serializeAiAction(record: {
  id: string;
  prompt: string;
  provider: string;
  model: string | null;
  parsedAction: Prisma.JsonValue;
  preview: Prisma.JsonValue | null;
  status: AiActionStatus;
  confidence: number | null;
  result: Prisma.JsonValue | null;
  errorMessage: string | null;
  createdAt: Date;
  executedAt: Date | null;
  user?: { id: string; name: string } | null;
}): AiActionDto {
  const parsed = (record.parsedAction ?? {}) as { action?: string; kind?: string };
  return {
    id: record.id,
    prompt: record.prompt,
    provider: record.provider,
    model: record.model,
    action: parsed.action ?? 'UNKNOWN',
    kind: parsed.kind ?? 'rejected',
    status: record.status,
    confidence: record.confidence,
    preview: record.preview ?? null,
    result: record.result ?? null,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt.toISOString(),
    executedAt: record.executedAt ? record.executedAt.toISOString() : null,
    user: record.user ? { id: record.user.id, name: record.user.name } : null,
  };
}

export async function listAiActions(params: {
  page: number;
  pageSize: number;
  status?: AiActionStatus;
  search?: string;
}): Promise<{ items: AiActionDto[]; total: number }> {
  const where: Prisma.AIActionWhereInput = {
    ...(params.status ? { status: params.status } : {}),
    ...(params.search?.trim()
      ? { prompt: { contains: params.search.trim(), mode: 'insensitive' as const } }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.aIAction.count({ where }),
    prisma.aIAction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: { user: { select: { id: true, name: true } } },
    }),
  ]);

  return { items: rows.map(serializeAiAction), total };
}

export async function getAiAction(id: string): Promise<AiActionDto> {
  const record = await prisma.aIAction.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true } } },
  });
  if (!record) throw new NotFoundError('That AI action no longer exists.');
  return serializeAiAction(record);
}
