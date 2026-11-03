import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { requireAgent } from '../lib/auth.js';
import { asyncHandler, parse } from '../lib/errors.js';
import { serializeTicket, ticketSelect } from '../lib/tickets.js';
import { dayKeys } from '../lib/time.js';

const router = Router();

router.get(
  '/',
  requireAgent,
  asyncHandler(async (req, res) => {
    const { days } = parse(
      z.object({
        days: z.coerce.number().int().refine((v) => [7, 14, 30, 90].includes(v)).default(14),
      }),
      req.query,
    );
    const workspaceId = req.user!.workspaceId;
    const db = getDb();
    const start = new Date(Date.now() - days * 86_400_000).toISOString();
    const tickets = db
      .prepare(`${ticketSelect()} WHERE t.workspace_id = ?`)
      .all(workspaceId)
      .map((row) => serializeTicket(row as never));

    const resolved = tickets.filter((ticket) =>
      ['resolved', 'closed'].includes(ticket.status),
    );
    const open = tickets.filter(
      (ticket) => !['resolved', 'closed'].includes(ticket.status),
    );
    const responded = tickets.filter((ticket) => ticket.firstResponseAt);
    const firstResponseMinutes = responded.map((ticket) =>
      (new Date(ticket.firstResponseAt!).getTime() -
        new Date(ticket.createdAt).getTime()) /
      60_000,
    );
    const resolutionMinutes = resolved
      .filter((ticket) => ticket.resolvedAt)
      .map(
        (ticket) =>
          (new Date(ticket.resolvedAt!).getTime() -
            new Date(ticket.createdAt).getTime()) /
          60_000,
      );
    const firstResponseMet = responded.filter(
      (ticket) =>
        ticket.sla.firstResponse.dueAt &&
        new Date(ticket.firstResponseAt!).getTime() <=
          new Date(ticket.sla.firstResponse.dueAt).getTime(),
    ).length;
    const resolutionMet = resolved.filter(
      (ticket) =>
        ticket.resolvedAt &&
        ticket.sla.resolution.dueAt &&
        new Date(ticket.resolvedAt).getTime() <=
          new Date(ticket.sla.resolution.dueAt).getTime(),
    ).length;
    const rated = resolved.filter((ticket) => ticket.csat);
    const aiResolved = resolved.filter((ticket) =>
      ['accepted', 'auto_sent'].includes(ticket.aiState),
    ).length;
    const autoResolved = resolved.filter((ticket) => ticket.aiState === 'auto_sent').length;

    const dailyRows = db
      .prepare(
        `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS created
         FROM tickets WHERE workspace_id = ? AND created_at >= ? GROUP BY day`,
      )
      .all(workspaceId, start) as unknown as Array<{ day: string; created: number }>;
    const resolvedRows = db
      .prepare(
        `SELECT substr(resolved_at, 1, 10) AS day, COUNT(*) AS resolved
         FROM tickets WHERE workspace_id = ? AND resolved_at >= ? GROUP BY day`,
      )
      .all(workspaceId, start) as unknown as Array<{ day: string; resolved: number }>;
    const createdMap = new Map(dailyRows.map((row) => [row.day, row.created]));
    const resolvedMap = new Map(resolvedRows.map((row) => [row.day, row.resolved]));
    const series = dayKeys(days).map((date) => ({
      date,
      created: createdMap.get(date) ?? 0,
      resolved: resolvedMap.get(date) ?? 0,
    }));

    const categoryMap = new Map<string, number>();
    for (const ticket of tickets) {
      categoryMap.set(ticket.category, (categoryMap.get(ticket.category) ?? 0) + 1);
    }
    const categories = [...categoryMap.entries()]
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => b.value - a.value);

    const priorities = ['urgent', 'high', 'normal', 'low'].map((priority) => {
      const group = tickets.filter((ticket) => ticket.priority === priority);
      return {
        priority,
        total: group.length,
        breached: group.filter((ticket) => ticket.sla.status === 'breached').length,
        atRisk: group.filter((ticket) => ticket.sla.status === 'at_risk').length,
      };
    });

    const agents = db
      .prepare(
        `SELECT u.id, u.name, u.avatar_color,
          (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id AND t.status NOT IN ('resolved','closed')) AS open_tickets,
          (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id AND t.status IN ('resolved','closed') AND t.resolved_at >= ?) AS resolved_tickets,
          (SELECT AVG((julianday(t.first_response_at) - julianday(t.created_at)) * 24 * 60)
             FROM tickets t WHERE t.assignee_id = u.id AND t.first_response_at IS NOT NULL) AS avg_first_response
         FROM users u WHERE u.workspace_id = ? AND u.role IN ('OWNER','ADMIN','AGENT') AND u.status = 'active'
         ORDER BY open_tickets DESC`,
      )
      .all(start, workspaceId) as unknown as Array<Record<string, unknown>>;

    const aiRuns = db
      .prepare('SELECT status, COUNT(*) AS count FROM ai_runs WHERE workspace_id = ? GROUP BY status')
      .all(workspaceId) as unknown as Array<{ status: string; count: number }>;
    const aiRunMap = Object.fromEntries(aiRuns.map((row) => [row.status, row.count]));
    const aiTotal = aiRuns.reduce((sum, row) => sum + row.count, 0);

    const recentRuns = db
      .prepare(
        `SELECT r.id, r.confidence, r.recommended_action, r.status, r.created_at,
                t.id AS ticket_id, t.number, t.subject
         FROM ai_runs r JOIN tickets t ON t.id = r.ticket_id
         WHERE r.workspace_id = ? ORDER BY r.created_at DESC LIMIT 8`,
      )
      .all(workspaceId) as unknown as Array<Record<string, unknown>>;

    res.json({
      data: {
        summary: {
          total: tickets.length,
          open: open.length,
          resolved: resolved.length,
          waiting: tickets.filter((ticket) => ticket.status === 'waiting_customer').length,
          breached: open.filter((ticket) => ticket.sla.status === 'breached').length,
          avgFirstResponse: Math.round(
            firstResponseMinutes.length
              ? firstResponseMinutes.reduce((a, b) => a + b, 0) / firstResponseMinutes.length
              : 0,
          ),
          avgResolution: Math.round(
            resolutionMinutes.length
              ? resolutionMinutes.reduce((a, b) => a + b, 0) / resolutionMinutes.length
              : 0,
          ),
          firstResponseCompliance: responded.length
            ? Math.round((firstResponseMet / responded.length) * 1000) / 10
            : 100,
          resolutionCompliance: resolved.length
            ? Math.round((resolutionMet / resolved.length) * 1000) / 10
            : 100,
          csat: rated.length
            ? Math.round(
                (rated.reduce((sum, ticket) => sum + (ticket.csat ?? 0), 0) /
                  rated.length) *
                  10,
              ) / 10
            : 0,
          aiAdoption: resolved.length
            ? Math.round((aiResolved / resolved.length) * 1000) / 10
            : 0,
          autoResolved: resolved.length
            ? Math.round((autoResolved / resolved.length) * 1000) / 10
            : 0,
          aiRuns: aiTotal,
          aiAccepted: aiRunMap.accepted ?? 0,
          aiRejected: aiRunMap.rejected ?? 0,
        },
        series,
        categories,
        priorities,
        agents: agents.map((row) => ({
          id: row.id,
          name: row.name,
          color: row.avatar_color,
          openTickets: row.open_tickets,
          resolvedTickets: row.resolved_tickets,
          avgFirstResponse: Math.round(Number(row.avg_first_response ?? 0)),
        })),
        recentRuns: recentRuns.map((row) => ({
          id: row.id,
          ticketId: row.ticket_id,
          number: row.number,
          subject: row.subject,
          confidence: row.confidence,
          action: row.recommended_action,
          status: row.status,
          createdAt: row.created_at,
        })),
      },
    });
  }),
);

export default router;
