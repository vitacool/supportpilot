import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { asyncHandler, ApiError, parse } from '../lib/errors.js';
import { requireAuth, signToken } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';
import type { AuthUser, Role } from '../types.js';

const router = Router();
const attempts = new Map<string, { count: number; resetAt: number }>();

function throttle(key: string) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= 8) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', '登录尝试过于频繁，请 15 分钟后再试');
  }
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    entry.count += 1;
  }
}

function userView(row: {
  id: string;
  name: string;
  email: string;
  role: Role;
  workspace_id: string;
  avatar_color: string;
  created_at?: string;
  last_login_at?: string | null;
}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    workspaceId: row.workspace_id,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const body = parse(
      z.object({
        email: z.string().trim().email('请输入有效邮箱'),
        password: z.string().min(1, '请输入密码'),
      }),
      req.body,
    );
    throttle(`${req.ip}:${body.email.toLowerCase()}`);
    const user = getDb()
      .prepare('SELECT * FROM users WHERE lower(email) = lower(?)')
      .get(body.email) as
      | {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          role: Role;
          workspace_id: string;
          status: string;
          avatar_color: string;
          created_at: string;
          last_login_at: string | null;
        }
      | undefined;
    if (!user || !bcrypt.compareSync(body.password, user.password_hash)) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确');
    }
    if (user.status !== 'active') {
      throw new ApiError(403, 'ACCOUNT_DISABLED', '账号已被停用');
    }
    const lastLoginAt = nowIso();
    getDb()
      .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .run(lastLoginAt, user.id);
    const authUser: AuthUser = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      workspaceId: user.workspace_id,
      avatarColor: user.avatar_color,
    };
    req.user = authUser;
    writeAudit(req, 'auth.login', 'session', null, '登录客服工作台');
    res.json({
      data: {
        token: signToken(authUser),
        user: userView({ ...user, last_login_at: lastLoginAt }),
      },
    });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(req.user!.id) as never;
    res.json({ data: userView(row) });
  }),
);

export default router;
