import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';

let app: Express;
let adminToken = '';
let agentToken = '';
let customerToken = '';
let ticketId = '';
let tempDir = '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForKnowledgeIndexed(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await request(app)
      .get('/api/knowledge-bases/kb_help')
      .set('Authorization', `Bearer ${adminToken}`);
    const documents = response.body?.data?.documents ?? [];
    if (
      documents.length > 0 &&
      documents.every(
        (doc: { status: string; chunkCount: number }) =>
          doc.status === 'ready' && doc.chunkCount > 0,
      )
    ) {
      return;
    }
    await sleep(150);
  }
  throw new Error('knowledge index did not become ready');
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), 'supportpilot-test-'));
  process.env.ASTRA_DATA_DIR = tempDir;
  process.env.JWT_SECRET = 'test-secret';
  const { createApp } = await import('./app.js');
  app = createApp();

  const admin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'admin@supportpilot.local', password: 'Support@2026' });
  adminToken = admin.body.data.token;
  const agent = await request(app)
    .post('/api/auth/login')
    .send({ email: 'agent@supportpilot.local', password: 'Support@2026' });
  agentToken = agent.body.data.token;
  const customer = await request(app)
    .post('/api/auth/login')
    .send({ email: 'customer@supportpilot.local', password: 'Support@2026' });
  customerToken = customer.body.data.token;
});

afterAll(async () => {
  const { stopIndexWorker } = await import('./lib/indexer.js');
  const { closeVectorStore } = await import('./vector/index.js');
  const { closeDb } = await import('./db/index.js');
  await stopIndexWorker();
  await closeVectorStore();
  closeDb();
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Windows can hold a SQLite WAL handle briefly; the OS temp dir is disposable.
    }
  }
});

describe('SupportPilot API', () => {
  it('exposes health and authenticated user', async () => {
    const health = await request(app).get('/api/health');
    expect(health.status).toBe(200);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(me.body.data.role).toBe('OWNER');
    expect(me.body.data.workspaceId).toBe('ws_northstar');
  });

  it('lists tickets with SLA stats for agents', async () => {
    const response = await request(app)
      .get('/api/tickets?pageSize=5')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.tickets.length).toBe(5);
    expect(response.body.data.stats.open).toBeGreaterThan(0);
    expect(response.body.data.tickets[0].sla).toBeDefined();
  });

  it('blocks customers from the agent inbox', async () => {
    const response = await request(app)
      .get('/api/tickets')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(response.status).toBe(403);
  });

  it('creates a customer ticket and runs AI with citations', async () => {
    await waitForKnowledgeIndexed();
    const created = await request(app)
      .post('/api/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        subject: '忘记密码后无法登录后台',
        content:
          '我忘记了管理员账号密码，邮箱也收不到重置邮件。团队现在无法进入后台，应该怎么办？',
      });
    expect(created.status).toBe(201);
    ticketId = created.body.data.id;
    expect(created.body.data.number).toMatch(/^SP-/);

    const ai = await request(app)
      .post(`/api/tickets/${ticketId}/ai/run`)
      .set('Authorization', `Bearer ${agentToken}`);
    expect(ai.status).toBe(201);
    expect(ai.body.data.run.confidence).toBeGreaterThan(0);
    expect(ai.body.data.run.citations.length).toBeGreaterThan(0);
    expect(ai.body.data.run.draft).toContain('资料');
    expect(['ai_drafted', 'escalated', 'waiting_customer']).toContain(
      ai.body.data.ticket.status,
    );
  });

  it('lets an agent accept an AI draft and exposes it to the customer', async () => {
    const detail = await request(app)
      .get(`/api/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${agentToken}`);
    const run = detail.body.data.aiRuns[0];
    expect(run).toBeTruthy();

    const accepted = await request(app)
      .post(`/api/tickets/${ticketId}/ai/runs/${run.id}/accept`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ content: `${run.draft}\n\n如需继续排查，请回复本工单。`, send: true });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.status).toBe('waiting_customer');
    expect(accepted.body.data.firstResponseAt).toBeTruthy();

    const customerView = await request(app)
      .get(`/api/portal/tickets/${ticketId}`)
      .set('Authorization', `Bearer ${customerToken}`);
    expect(customerView.status).toBe(200);
    expect(customerView.body.data.messages.some((message: { role: string }) => message.role === 'agent')).toBe(
      true,
    );
    expect(customerView.body.data.aiRuns).toHaveLength(0);
  });

  it('enforces the ticket state machine', async () => {
    const response = await request(app)
      .post(`/api/tickets/${ticketId}/status`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ status: 'new' });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('shows customer portal tickets only for the owner', async () => {
    const portal = await request(app)
      .get('/api/portal/tickets')
      .set('Authorization', `Bearer ${customerToken}`);
    expect(portal.status).toBe(200);
    expect(portal.body.data.tickets.every((ticket: { customer: { id: string } }) => ticket.customer.id === 'usr_customer')).toBe(true);

    const other = await request(app)
      .get('/api/portal/tickets/tkt_1002')
      .set('Authorization', `Bearer ${customerToken}`);
    expect([403, 404]).toContain(other.status);
  });

  it('returns analytics with SLA and AI metrics', async () => {
    const response = await request(app)
      .get('/api/analytics?days=14')
      .set('Authorization', `Bearer ${agentToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data.summary.total).toBeGreaterThan(50);
    expect(response.body.data.series).toHaveLength(14);
    expect(response.body.data.summary.aiRuns).toBeGreaterThan(0);
  });

  it('runs the RAG evaluation and returns metrics', async () => {
    const response = await request(app)
      .post('/api/evaluation/run')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(201);
    expect(response.body.data.run.total).toBeGreaterThan(20);
    expect(response.body.data.run.retrievalRecall).toBeGreaterThan(0.5);
    expect(response.body.data.run.citationCoverage).toBeGreaterThan(0.5);
  });

  it('exposes settings and protects configuration changes', async () => {
    const settings = await request(app)
      .get('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(settings.status).toBe(200);
    expect(settings.body.data.embedding.backend).toBe('local');
    expect(settings.body.data.slaPolicies).toHaveLength(4);

    const forbidden = await request(app)
      .patch('/api/settings/ai')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({
        backend: 'mock',
        autoSend: true,
        confidenceThreshold: 0.8,
      });
    expect(forbidden.status).toBe(403);
  });
});
