import { Prisma, type AuditAction, type AuditSource } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { auditLogInclude, serializeAuditLog, type AuditLogDto } from './serializers.js';

export interface ListAuditParams {
  search?: string;
  action?: AuditAction;
  source?: AuditSource;
  employeeId?: string;
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

export async function listAuditLogs(
  params: ListAuditParams,
): Promise<{ items: AuditLogDto[]; total: number }> {
  const and: Prisma.AuditLogWhereInput[] = [];

  if (params.search) {
    const term = params.search.trim();
    if (term) {
      and.push({
        OR: [
          { summary: { contains: term, mode: 'insensitive' } },
          { employee: { name: { contains: term, mode: 'insensitive' } } },
          { user: { name: { contains: term, mode: 'insensitive' } } },
          { newSeat: { seatCode: { contains: term, mode: 'insensitive' } } },
          { previousSeat: { seatCode: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
  }
  if (params.action) and.push({ action: params.action });
  if (params.source) and.push({ source: params.source });
  if (params.employeeId) and.push({ employeeId: params.employeeId });
  if (params.from || params.to) {
    and.push({
      createdAt: {
        ...(params.from ? { gte: params.from } : {}),
        ...(params.to ? { lte: params.to } : {}),
      },
    });
  }

  const where: Prisma.AuditLogWhereInput = and.length ? { AND: and } : {};

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
      include: auditLogInclude,
    }),
  ]);

  return { items: rows.map(serializeAuditLog), total };
}

export async function getAuditSummary(): Promise<{
  bySource: Array<{ source: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
  total: number;
}> {
  const [bySource, byAction, total] = await Promise.all([
    prisma.auditLog.groupBy({ by: ['source'], _count: { _all: true } }),
    prisma.auditLog.groupBy({ by: ['action'], _count: { _all: true } }),
    prisma.auditLog.count(),
  ]);

  return {
    bySource: bySource.map((row) => ({ source: row.source, count: row._count._all })),
    byAction: byAction
      .map((row) => ({ action: row.action, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    total,
  };
}
