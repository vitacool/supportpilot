# 部署指南

SupportPilot 由两部分组成：

1. **Web + API 应用**：一个 Node.js 容器，生产模式托管前端与 API。
2. **pgvector 向量库**：生产建议使用 PostgreSQL + pgvector。

业务元数据默认存储在 SQLite（`/app/data/supportpilot.db`）。Demo 可以这样跑；正式多实例部署需要把业务库迁移到 PostgreSQL。

---

## 方案 A：Render + Neon（推荐用于公网 Demo）

### 1. 创建 Neon PostgreSQL

1. 注册 [Neon](https://neon.tech)，创建项目。
2. 在 SQL Editor 执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

3. 复制 Pooled connection string，形如：

```text
postgresql://user:password@host/db?sslmode=require
```

### 2. 创建 Render Blueprint

仓库根目录已包含 `render.yaml`。

1. Render → New → Blueprint。
2. 连接 GitHub 仓库 `vitacool/supportpilot`。
3. Render 会识别 `render.yaml`，创建 Docker Web Service。
4. 填写环境变量：

| 变量 | 值 |
| --- | --- |
| `VECTOR_DATABASE_URL` | Neon 连接串 |
| `JWT_SECRET` | Render 可自动生成 |
| `APP_SECRET` | Render 可自动生成 |

5. 部署完成后访问 Render 分配的 HTTPS 域名。

### 3. 初始化

首次启动会自动：

- 创建 SQLite 业务库
- 生成演示用户、工单、知识库
- 建立向量索引

登录：

```text
admin@supportpilot.local / Support@2026
```

然后进入「AI 评测」运行一次评测，确认向量检索正常。

> Render 免费实例的本地磁盘不是持久化保证。用于 Demo 足够；需要长期保存业务数据时，请挂载持久磁盘或将业务库迁移到 PostgreSQL。
>
> 免费实例会休眠，首次访问可能需要 30–60 秒冷启动。

### 4. 自定义域名

Render → Settings → Custom Domains，按提示配置 CNAME。

---

## 方案 B：Railway

1. Railway → New Project → Deploy from GitHub repo。
2. 添加 PostgreSQL 服务，并安装 pgvector（Railway 的 Postgres 模板支持扩展）。
3. 在 Postgres SQL Editor 执行：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

4. 在应用服务中设置：

```env
NODE_ENV=production
PORT=8788
JWT_SECRET=<random>
APP_SECRET=<random>
VECTOR_DATABASE_URL=<Railway Postgres URL>
```

5. 暴露 8788 端口，生成公网域名。

---

## 方案 C：Fly.io

```bash
fly launch --no-deploy
fly secrets set JWT_SECRET=... APP_SECRET=... VECTOR_DATABASE_URL=...
fly deploy
```

`fly.toml` 需要将内部端口设置为 `8788`，并为 `/app/data` 挂载 volume：

```toml
[http_service]
  internal_port = 8788
  force_https = true

[[mounts]]
  source = "supportpilot_data"
  destination = "/app/data"
```

向量库可以使用 Fly Postgres 或外部 Neon。

---

## 方案 D：自有服务器 / Docker Compose

```bash
cp .env.example .env
# 修改 JWT_SECRET / APP_SECRET
docker compose up -d --build
```

Compose 会启动：

- `supportpilot`：应用，端口 8788
- `vector-db`：`pgvector/pgvector:pg17`

生产建议：

- 前面加 Nginx / Caddy，启用 HTTPS
- 只暴露 443，不直接暴露 8788
- 为 `/app/data` 做定期备份
- 使用外部 pgvector 时，删除 `vector-db` 服务并设置 `VECTOR_DATABASE_URL`
- 配置 `CORS_ORIGINS`
- 将登录 Cookie 化、引入 Redis 限流和多实例任务锁

---

## 公网 Demo 检查清单

- [ ] 修改 `JWT_SECRET` / `APP_SECRET`
- [ ] 通过 HTTPS 访问
- [ ] 使用 Neon/Railway pgvector，而不是容器内临时数据库
- [ ] 在「设置」中确认 Embedding 配置
- [ ] 运行一次「AI 评测」
- [ ] 用客服账号测试 AI 草稿 → 人工采纳
- [ ] 用客户账号测试提交 → 回复 → CSAT
- [ ] 配置登录限流与调用预算
- [ ] 不要使用演示密码作为正式账号密码
- [ ] 定期备份 SQLite / PostgreSQL

## 公开演示的安全注意

公网 Demo 建议：

- 只读账号或按 IP 限流
- 禁用自动发送
- 限制 AI 调用频率与每日预算
- 不接入真实客户数据
- 关闭注册入口
- 定期重置演示数据库
