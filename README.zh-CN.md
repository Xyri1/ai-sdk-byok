# ai-sdk-byok

[English](README.md) | 中文

为 AI SDK 应用提供自带密钥（BYOK）能力的凭据存储辅助库。

`ai-sdk-byok` 帮助应用程序接入用户自有的 AI 服务商 API 密钥，省去从头搭建完整密钥管理流程的工作。凭据按用户维度存储，只在服务端构建 Provider 时才按需取出明文，列表接口始终不返回原始密钥。

v0.2 版本仍保持聚焦：单字段 `{ apiKey }` 凭据、Supabase Vault、Cloudflare 和 Drizzle SQL 适配器，以及 ESM 入口。

## 功能特性

- `save`、`list`、`delete` 操作均只返回元数据，不暴露用户 API 密钥。
- 通过独立的 `get` 接口显式获取明文凭据，确保取用时机尽量靠后。
- 凭据对象内置防护，阻断 `JSON.stringify` 及对象字符串化时的意外泄露。
- Provider 名称使用不透明字符串，由应用自行定义，无任何内置约束。
- Supabase Vault 存储适配器，底层 RPC 函数仅限 service role 访问。
- Drizzle PostgreSQL 存储适配器，在应用侧使用 AES-256-GCM 加密。
- 提供 `ai-sdk-byok`、`@ai-sdk-byok/supabase`、`@ai-sdk-byok/cloudflare` 和 `@ai-sdk-byok/drizzle` 的 ESM 包。

## 软件包

| 软件包 | 用途 |
| --- | --- |
| `ai-sdk-byok` | 核心 manager、校验、元数据和凭据安全保护。 |
| `@ai-sdk-byok/supabase` | Supabase Vault 存储适配器。 |
| `@ai-sdk-byok/cloudflare` | Cloudflare D1 存储适配器和 Workers KV 凭据缓存。 |
| `@ai-sdk-byok/drizzle` | 带应用侧加密的 Drizzle PostgreSQL 存储适配器。 |

## 安装

```sh
# Supabase
npm install ai-sdk-byok @ai-sdk-byok/supabase @supabase/supabase-js

# Cloudflare Workers（D1 + KV）
npm install ai-sdk-byok @ai-sdk-byok/cloudflare

# Drizzle + PostgreSQL
npm install ai-sdk-byok @ai-sdk-byok/drizzle drizzle-orm
```

`@supabase/supabase-js` 是可选的对等依赖（peer dependency），使用 Supabase 适配器时需一并安装。
`drizzle-orm` 是 `@ai-sdk-byok/drizzle` 的对等依赖，使用 Drizzle 适配器时需一并安装。

## 快速上手

以下示例使用 Supabase 适配器——切换适配器时只需替换 `storage` 一行。完整的接入流程（包括迁移和密钥配置）请参阅各适配器指南：[Supabase](docs/guides/supabase.md)、[Cloudflare](docs/guides/cloudflare.md)、[Drizzle](docs/guides/drizzle.md)。

将 [`packages/supabase/migrations`](packages/supabase/migrations) 中的迁移文件应用到已启用 Vault 的 Supabase 项目，然后在受信任的服务端代码中创建 manager：

```ts
import { createByokManager } from 'ai-sdk-byok';
import { supabaseAdapter } from '@ai-sdk-byok/supabase';
import { createClient } from '@supabase/supabase-js';

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
);

export const byok = createByokManager({
  storage: supabaseAdapter({ client: supabaseAdmin }),
});
```

保存或轮换用户密钥：

```ts
await byok.keys.save({
  userId: 'user_123',
  provider: 'openai',
  credentials: { apiKey: process.env.USER_OPENAI_KEY! },
});
```

仅在构建 Provider 时取出密钥：

```ts
const credentials = await byok.keys.get({
  userId: 'user_123',
  provider: 'openai',
});

if (!credentials) {
  throw new Error('未配置 OpenAI 密钥');
}

// 将 credentials.apiKey 传入 AI SDK Provider 工厂函数。
```

省略 `label` 时，凭据会以 `default` 标签存取。

## 通过 Agent 集成

将下面这句话发给你的编码 Agent，它会自动完成完整的接入流程：安装依赖、应用数据库迁移、初始化 manager，以及添加密钥存取的调用示例。

```text
Integrate `ai-sdk-byok` into this project by following https://github.com/Xyri1/ai-sdk-byok/blob/master/docs/agent-implementation.md
```

## API

manager 提供以下方法：

| 方法 | 说明 |
| --- | --- |
| `keys.save(input)` | 为 `(userId, provider, label)` 存储或轮换一条 `{ apiKey }` 凭据，仅返回元数据。 |
| `keys.list(input)` | 列出某用户的凭据元数据，按最新更新时间倒序排列，不返回明文凭据。 |
| `keys.get(input)` | 返回经 Proxy 包装的 `{ apiKey }` 凭据，若不存在则返回 `null`。 |
| `keys.getById(input)` | 通过 `{ userId, keyId }` 返回元数据加经 Proxy 包装的 `{ apiKey }` 凭据，若不存在则返回 `null`。 |
| `keys.delete(input)` | 通过 `userId` 和 `keyId` 删除密钥，公开 API 的删除操作是幂等的。 |

适配器工厂函数：`supabaseAdapter({ client })`、`d1Adapter({ database, encryptionKey })` 与 `kvCredentialCache({ namespace, encryptionKey })`，以及 `drizzleAdapter({ db, dialect, encryption })`。所有导出、选项表、校验规则和错误类型详见 [API 参考](docs/reference/api.md)。

## 安全说明

- 只存储严格符合 `{ apiKey: string }` 结构的单字段凭据。
- 请勿将凭据记录到日志、序列化输出，或在请求响应中返回。
- 尽量推迟 `keys.get` 的调用时机，在完成 Provider 构建后尽早让凭据离开作用域。
- 元数据会包含简短的 `keyHint` 提示，但不会暴露底层 Vault 中的 secret ID。
- Supabase 凭据 RPC 函数仅限 service role 调用。
- Drizzle 主密钥不会存储在 SQL 中；丢失主密钥会导致已存储凭据无法恢复。

## 运行时支持

- Node.js 22 及以上版本。
- 仅支持 ESM 导入。
- 核心包和各适配器入口均使用 ESM；Drizzle 适配器要求 Node.js 22 及以上版本，并由应用选择兼容运行时的 PostgreSQL 驱动。

## 文档

- [快速开始](docs/getting-started.md) — 核心概念与最小端到端流程。
- 集成指南：[Supabase Vault](docs/guides/supabase.md) · [Cloudflare D1 + KV](docs/guides/cloudflare.md) · [Drizzle Postgres](docs/guides/drizzle.md) · [凭据缓存](docs/guides/caching.md)
- [API 参考](docs/reference/api.md) — 所有导出、选项和错误类型。
- [安全指南](docs/security.md) — 安全保证、接入规则与防护边界。
- [Agent 集成指南](docs/agent-implementation.md) — 面向编码 Agent；[`llms.txt`](llms.txt) 索引全部文档。
- 内部文档：[架构说明](docs/development/architecture.md) · [威胁模型](docs/development/threat-model.md) · [集成测试](docs/development/integration-testing.md) · [发布检查清单](docs/development/release-checklist.md)

## 示例

- [Next.js + Supabase](examples/nextjs-supabase/README.md) — 包含密钥管理 UI 和使用 Supabase 适配器的 AI SDK 聊天路由。
- [Cloudflare Worker](examples/cloudflare-worker/README.md) — 基于 Hono 的 Worker，含密钥管理 UI、流式聊天和 workerd 端到端测试套件。
- [Drizzle + Postgres](examples/drizzle/README.md) — Node + Hono 密钥管理 UI 和流式聊天，Drizzle 适配器可对接任意 Postgres。

## 开发

```sh
npm install
npm run check
```

本项目遵循规格驱动开发（SDD）流程。从[需求文档](docs/specs/001-ai-sdk-byok/requirements.md)开始，然后按[任务清单](docs/specs/001-ai-sdk-byok/tasks.md)推进。
