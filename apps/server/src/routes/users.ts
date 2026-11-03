import { Router } from 'express';
import { getDb } from '../db/index.js';
import { requireAgent } from '../lib/auth.js';
import { asyncHandler } from '../lib/errors.js';

const router = Router();

router.get(
  '/agents',
  requireAgent,
  asyncHandler(async (req, res) => {
    const rows = getDb()
      .prepare(
        `SELECT u.id, u.name, u.email, u.role, u.avatar_color, u.status,
                (SELECT COUNT(*) FROM tickets t WHERE t.assignee_id = u.id AND t.status NOT IN ('resolved','closed')) AS open_tickets
         FROM users u
         WHERE u.workspace_id = ? AND u.role IN ('OWNER','ADMIN','AGENT') AND u.status = 'active'
         ORDER BY u.name`,
      )
      .all(req.user!.workspaceId) as unknown as Array<Record<string, unknown>>;
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        avatarColor: row.avatar_color,
        openTickets: row.open_tickets,
      })),
    });
  }),
);

export default router;
