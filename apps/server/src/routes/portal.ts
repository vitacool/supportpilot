import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAuth } from '../lib/auth.js';
import { asyncHandler, ApiError } from '../lib/errors.js';
import { serializeTicket, ticketDetail, ticketSelect } from '../lib/tickets.js';

const router = Router();

router.get(
  '/tickets',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'CUSTOMER') {
      throw new ApiError(403, 'FORBIDDEN', '仅客户可以使用自助门户');
    }
    const rows = getDb()
      .prepare(
        `${ticketSelect()} WHERE t.workspace_id = ? AND t.customer_id = ? ORDER BY t.updated_at DESC`,
      )
      .all(req.user!.workspaceId, req.user!.id) as unknown as Array<
      Parameters<typeof serializeTicket>[0]
    >;
    const tickets = rows.map(serializeTicket);
    res.json({
      data: {
        tickets,
        stats: {
          open: tickets.filter((ticket) => !['resolved', 'closed'].includes(ticket.status))
            .length,
          resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
          total: tickets.length,
        },
      },
    });
  }),
);

router.get(
  '/tickets/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = getDb()
      .prepare(
        `${ticketSelect()} WHERE t.id = ? AND t.workspace_id = ? AND t.customer_id = ?`,
      )
      .get(req.params.id, req.user!.workspaceId, req.user!.id) as unknown as
      | Parameters<typeof serializeTicket>[0]
      | undefined;
    if (!row) throw new ApiError(404, 'NOT_FOUND', '工单不存在');
    res.json({ data: ticketDetail(row as never, req.user!) });
  }),
);

export default router;
