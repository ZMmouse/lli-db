# @llii/db

`@llii/db` 是一个基于 [Knex](https://knexjs.org/) 的 TypeScript ORM。它通过模型描述数据库表，并提供 CRUD、条件查询、分页、关联、事务、软删除、字段转换和中间件等能力。

> 这是一个学习和业务实践项目，部分实现参考了 Strapi 的 Database 层。当前版本仍在演进，投入生产前请结合自己的数据规模和数据库类型进行验证。

## 安装

安装 ORM 和所使用的数据库驱动。

```bash
# SQLite
npm install @llii/db better-sqlite3

# PostgreSQL（当前为预览支持，尚未完成项目级契约验证）
npm install @llii/db pg
```

## 快速开始

### 1. 定义模型

模型的 `code` 是代码中的唯一标识，`tableName` 是实际数据库表名。字段同样需要同时声明业务字段名 `code` 和数据库列名 `columnName`。

```typescript
import {
  SysFieldTypeEnum,
  type IModel,
} from '@llii/db';

const models: IModel[] = [
  {
    code: 'user',
    name: '用户',
    tableName: 'users',
    useCreatedFields: true,
    useUpdatedFields: true,
    useLogicDelete: true,
    attributes: {
      username: {
        code: 'username',
        name: '用户名',
        columnName: 'username',
        type: SysFieldTypeEnum.TEXT,
        required: true,
        unique: true,
      },
      email: {
        code: 'email',
        name: '邮箱',
        columnName: 'email',
        type: SysFieldTypeEnum.TEXT,
      },
      enabled: {
        code: 'enabled',
        name: '是否启用',
        columnName: 'enabled',
        type: SysFieldTypeEnum.SWITCH,
        default: true,
      },
    },
  },
];
```

每个模型都会自动获得字符串类型的 `id` 字段。`useCreatedFields`、`useUpdatedFields` 和 `useLogicDelete` 会分别补充创建信息、更新信息和逻辑删除相关字段。创建时显式传入的 `createdAt`/`updatedAt` 会被保留；调用 `update` 或 `updateMany` 时，`updatedAt` 始终由系统设置为本次更新时刻，显式传入值不会覆盖它。

模型定义会经过集中校验：模型 `code` 和 `tableName` 必须全局唯一；属性对象的 key 必须与属性 `code` 相同，同一模型内的 `columnName` 不能重复；索引字段、单/多引用关系、中间模型及父子模型必须指向实际存在的模型和字段。校验失败会抛出 `code` 为 `LLI400` 的 `LliDbError`，错误消息包含类似 `models[0].attributes.email.code` 的精确位置。

`Database` 会在创建数据库连接前执行结构和引用校验。字段类型会在 `ModelTableMigrator.syncAll()` 执行 DDL 前，结合当时已注册的字段类型再次校验，因此自定义字段仍可在实例创建后通过 `db.fieldTypeManager.extends(...)` 注册。也可以直接调用公开的 `validateModels(models)` 检查模型定义；该调用不连接数据库，也不会修改传入对象。

### 2. 创建数据库实例

SQLite：

```typescript
import { Database } from '@llii/db';

export const db = new Database({
  connection: {
    client: 'better-sqlite3',
    connection: {
      filename: './data.sqlite3',
    },
    useNullAsDefault: true,
  },
  models,
  query: {
    maxPageSize: 1000,
    maxLimit: 1000,
    maxOffset: 100000,
    populateBatchSize: 500,
  },
  modelConfig: {
    userModelCode: 'user',
    userModelDisplayCode: 'username',
  },
});
```

PostgreSQL：

> PostgreSQL 当前属于预览支持：配置可被识别，但 CRUD、DDL 和并发迁移尚未在容器契约测试中验证。当前正式验证的组合是 Knex `^3.1.0` + `better-sqlite3` `^12.5.0`。

```typescript
import { Database } from '@llii/db';

export const db = new Database({
  connection: {
    client: 'postgres',
    connection: {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    },
  },
  models,
  modelConfig: {
    userModelCode: 'user',
    userModelDisplayCode: 'username',
  },
});
```

应用退出时应关闭连接池：

```typescript
await db.close();
```

完整支持等级、client 别名和测试范围见 [数据库驱动兼容性](docs/数据库驱动兼容性.md)。矩阵外的 Knex client 会在 `Database` 创建时抛出 `LLI400`。

## 加密配置

普通模型不需要配置 `encrypt`。`EncryptText` 默认使用带随机盐的 `scrypt`，适合保存密码摘要，不需要 AES key 或 IV，也不能还原明文。

需要还原明文的字段应显式使用 `aes-256-gcm`，并提供 32 字节 key：

```typescript
const db = new Database({
  connection,
  models,
  encrypt: {
    key: Buffer.from(process.env.DB_ENCRYPTION_KEY_HEX ?? '', 'hex'),
    // 仅迁移旧 aes-256-cbc 数据时需要：
    iv: Buffer.from(process.env.DB_ENCRYPTION_IV_HEX ?? '', 'hex'),
    salt: process.env.DB_LEGACY_HASH_SALT,
  },
});

const secretAttribute = {
  code: 'secret',
  name: '密文',
  columnName: 'secret',
  type: SysExpansionFieldTypeEnum.ENCRYPT_TEXT,
  primitiveType: SysFieldTypeEnum.TEXT,
  expansionConfig: { type: 'aes-256-gcm' },
};
```

新密文格式为 `$EN$v2$<nonce>$<authTag>$<ciphertext>`。每次写入都会生成随机 nonce，读取时会校验认证标签；密文、标签或 key 不正确时会抛错，不会返回空字符串。

旧 `aes-256-cbc` 字段配置仍可读取 `$EN$<hex>` 数据，但新写入统一生成 GCM 格式。旧 IV 只用于解密历史数据。不要把生产 key/IV 直接写入模型源码。

密码校验使用 `db.encrypt.verifyHash(plainText, storedHash, legacySalt)`，它同时支持新 scrypt 摘要和旧 SHA-256 摘要。若 `db.encrypt.needsHashUpgrade(storedHash)` 为 `true`，应在本次认证成功后用 `db.encrypt.hash(plainText)` 重算并保存。

完整的数据升级步骤见 [加密格式升级说明](docs/加密格式升级说明.md)。

## CRUD

### 创建

```typescript
const user = await db.query('user').create({
  data: {
    username: 'alice',
    email: 'alice@example.com',
  },
});

const users = await db.query('user').createMany({
  data: [
    { username: 'bob', email: 'bob@example.com' },
    { username: 'carol', email: 'carol@example.com' },
  ],
});
```

### 查询

```typescript
const user = await db.query('user').findOne({
  where: { username: 'alice' },
});

const users = await db.query('user').findMany({
  where: {
    enabled: true,
    username: { startsWith: 'a' },
  },
  select: ['id', 'username', 'email'],
  orderBy: { username: 'asc' },
  limit: 20,
});

const page = await db.query('user').queryPage({
  page: 1,
  pageSize: 20,
  orderBy: { createdAt: 'desc' },
});

console.log(page.rows, page.total);
```

`page` 必须从 1 开始并与 `pageSize` 同时提供，`limit` 必须大于 0，`offset` 必须大于等于 0；两套分页方式不能混用。默认 `pageSize` 和 `limit` 最大为 1000，`offset` 及分页计算出的偏移最大为 100000，可通过 `Database` 的 `query` 配置调整。populate 默认每 500 个关联 ID 顺序执行一批查询，避免超过数据库绑定参数上限。

当前版本提供 `findCursorPage()` keyset 分页，并自动追加 `id asc` 作为最终唯一键；`after` 必须精确包含最终排序字段且值类型必须匹配模型。普通 cursor 不提供跨请求快照一致性，排序字段在翻页期间被修改时记录可能重新出现；需要强一致集合时请配合 `ReadSnapshot`。原有 offset/page 分页继续保留。

### 更新

```typescript
const updated = await db.query('user').update({
  where: { id: user.id },
  data: { email: 'new-email@example.com' },
});

const result = await db.query('user').updateMany({
  where: { enabled: false },
  data: { email: null },
});

// 确实需要更新全表时必须显式确认：
const allResult = await db.query('user').updateMany({
  allowAll: true,
  data: { enabled: false },
});

console.log(result.count, result.updateIds);
```

### 删除

```typescript
await db.query('user').delete({
  where: { id: user.id },
});

await db.query('user').deleteMany({
  where: { enabled: false },
});
```

新代码应统一使用 `where`。`filters` 作为向后兼容别名仍可用于顶层查询、写操作和 `populate` 参数，但已在 TypeScript 类型中标记为弃用；当 `where` 与 `filters` 同时出现时，两组条件按 AND 合并，不会静默忽略任意一组。

底层 QueryBuilder 的 `returning(fieldCode)` 接收模型字段 code，而不是数据库列名。构建 SQL 时会自动转换自定义 `columnName`，返回对象也统一使用模型字段 code。可以传入 `'*'`、单个字段或非空字段数组；空字段、重复字段、未知字段以及 `'*'` 与其他字段混用都会在执行 SQL 前抛出 `LLI400`。写操作需要稳定的统一结果时使用 `executeMutation<T>()`，返回 `{ count, rows }`；未调用 `returning()` 时 `rows` 为空数组。

查询及写入 API 不会修改调用方传入的 `data`、`select`、`populate` 或 `where` 对象；字段名转换、关联查询所需字段和内置中间件数据都在内部副本上处理。

`updateMany` 默认要求 `where`（或兼容的 `filters`）包含实际条件；更新全表必须显式设置 `allowAll: true`。逻辑删除模型自动附加的内部条件不能代替调用方确认。`delete` 和 `deleteMany` 要求 `where` 非空。启用了 `useLogicDelete` 的模型会执行逻辑删除，否则执行物理删除。

## 条件查询

支持的比较操作符包括：

- `eq`、`notEq`
- `gt`、`egt`、`lt`、`elt` 及相应的 `not*` 操作符
- `in`、`notIn`
- `like`、`notLike`
- `between`、`notBetween`
- `isNull`
- `startsWith`、`endsWith` 及相应的 `not*` 操作符

逻辑操作符为 `and`、`or` 和 `not`。

```typescript
const users = await db.query('user').findMany({
  where: {
    or: [
      { username: { startsWith: 'admin' } },
      {
        and: [
          { email: { endsWith: '@example.com' } },
          { createdAt: { egt: new Date('2026-01-01') } },
        ],
      },
    ],
  },
});
```

## 聚合

```typescript
const count = await db.query('user').count({
  where: { enabled: true },
});

const maxScore = await db.query('user').max({}, 'score');
const minScore = await db.query('user').min({}, 'score');
```

## 关联模型

### 单引用

```typescript
const post: IModel = {
  code: 'post',
  name: '文章',
  tableName: 'posts',
  attributes: {
    title: {
      code: 'title',
      name: '标题',
      columnName: 'title',
      type: SysFieldTypeEnum.TEXT,
    },
    author: {
      code: 'author',
      name: '作者',
      columnName: 'author_id',
      type: SysFieldTypeEnum.SINGLE_QUOTE,
      refCode: 'user',
      refFieldCode: 'id',
      refDisplayCode: 'username',
    },
  },
};
```

查询关联数据：

```typescript
const postWithAuthor = await db.query('post').findOne({
  where: { id: 'post-id' },
  populate: {
    author: {
      select: ['id', 'username', 'email'],
    },
  },
});
```

### 多对多

多对多关系需要一个中间模型，并在 `MULTI_QUOTE` 字段中声明中间模型及双方字段。

```typescript
roles: {
  code: 'roles',
  name: '角色',
  columnName: 'roles',
  type: SysFieldTypeEnum.MULTI_QUOTE,
  refCode: 'role',
  refFieldCode: 'id',
  refDisplayCode: 'name',
  midCode: 'userRole',
  selfInMidFieldCode: 'userId',
  refInMidFieldCode: 'roleId',
}
```

创建或更新时直接传入关联记录的 ID：

```typescript
await db.query('user').create({
  data: {
    username: 'alice',
    roles: ['role-1', 'role-2'],
  },
});
```

单条创建即使只传入多对多字段，也会写入中间表。主记录和中间表记录在同一事务中；任一关系写入失败时，本次主记录创建会一起回滚。

### 父子表

子模型通过 `parentCode` 和 `parentRefFieldCode` 指向父模型。写入父模型时，子表数据的参数名为 `${childCode}List`。

```typescript
await db.query('order').create({
  data: {
    number: 'ORD-001',
    orderItemList: [
      { productName: 'Keyboard', quantity: 1 },
      { productName: 'Mouse', quantity: 2 },
    ],
  },
});
```

### 树形模型

启用 `useTree` 的模型必须定义业务字段 `code`。创建树节点时必须同时传入非空的 `code` 和 `parentUri`；更新节点的 `parentId` 时，也必须在同一份 `data` 中传入更新后的 `code` 和 `parentUri`。

## 事务

回调式事务会自动提交或回滚。在回调中调用的查询会通过异步上下文自动加入当前事务。

```typescript
await db.transaction(async ({ onCommit, onRollback }) => {
  await db.query('user').create({
    data: { username: 'transaction-user' },
  });

  onCommit(() => console.log('transaction committed'));
  onRollback(() => console.log('transaction rolled back'));
});
```

`onCommit` 和 `onRollback` 支持异步回调，事务 Promise 会等待所有已注册回调结束。提交回调在数据库提交成功后执行；回调失败会拒绝事务 Promise，但已提交的数据不会再回滚。回滚回调在数据库完成回滚后执行；如果事务主体与回滚回调都失败，回滚回调错误会被抛出，事务主体错误保存在该错误的 `cause` 中。

也可以手动控制事务：

```typescript
const trx = await db.transaction();

try {
  await db
    .createQueryBuilder('user')
    .insert({ id: 'user-id', username: 'manual-transaction' })
    .transacting(trx.get())
    .execute();
  await trx.commit();
} catch (error) {
  await trx.rollback();
  throw error;
}
```

## 中间件

可以为某类操作注册全局中间件：

```typescript
db.middlewareManager.registerGlobalMiddleware('create', async (ctx, next) => {
  const startedAt = Date.now();
  await next();
  console.log(`${ctx.model.code} created in ${Date.now() - startedAt}ms`);
});
```

模型也可以通过 `middlewares` 配置自己的操作中间件。内置中间件负责逻辑删除过滤、时间戳和树形模型处理。

## 生命周期

生命周期在对应操作的中间件链前后执行，事件名为 `beforeCreate`、`afterCreate`、`beforeUpdate`、`afterUpdate` 等 `before/after + 操作名` 组合。`before` 可以修改本次操作使用的内部参数，`after` 可以读取结果；每个订阅者的 `state` 会从 before 阶段传递到 after 阶段。只有操作成功才执行 after，异步钩子会被等待。

```typescript
const unsubscribe = db.lifecycleProvider.subscribe({
  models: ['user'],
  beforeCreate(event) {
    event.state.startedAt = Date.now();
  },
  afterCreate(event) {
    console.log(event.result, event.state.startedAt);
  },
});

unsubscribe();
```

如果 after 钩子失败，调用会被拒绝，但此时操作本身可能已经提交；after 更适合通知、审计等提交后逻辑，不应依赖它回滚数据库写入。

## 诊断与日志

库默认不向控制台输出查询错误。可以在创建数据库时注入兼容现有日志框架的 logger，并订阅结构化诊断事件：

```typescript
const db = new Database({
  connection,
  models,
  diagnostics: {
    logger: {
      debug(message, event) {
        appLogger.debug({ event }, message);
      },
      info(message, event) {
        appLogger.info({ event }, message);
      },
      error(message, event) {
        appLogger.error({ event }, message);
      },
    },
    onEvent(event) {
      metrics.record(event.type, event.durationMs);
    },
  },
});

const unsubscribe = db.onDiagnostic((event) => {
  // query:start/query:success/query:error
  // migration:start/migration:success/migration:error
  // migration:model:start/migration:model:success/migration:model:error
});

unsubscribe();
```

事件只包含事件类型、时间、模型 code、操作名、耗时、结果数量、模型数量及脱敏后的错误名称/代码。不会包含 SQL、bindings、业务 `data`、错误 message 或 stack。logger 和监听器抛错或异步拒绝不会改变数据库操作结果。

## 字段类型

基础字段类型：

| 枚举值 | 说明 |
| --- | --- |
| `TEXT` | 短文本 |
| `LONG_TEXT` | 长文本 |
| `INT` | 整数 |
| `FLOAT` | 浮点数 |
| `DATE` | 日期 |
| `DATETIME` | 日期时间 |
| `TIME` | 时间 |
| `SWITCH` | 布尔值 |
| `JSON` | JSON 数据 |
| `SINGLE_QUOTE` | 单引用关系 |
| `MULTI_QUOTE` | 多对多关系 |

扩展字段类型由 `SysExpansionFieldTypeEnum` 提供：

| 枚举值 | 说明 |
| --- | --- |
| `SINGLE_SELECT` | 单选值 |
| `MULTI_SELECT` | 多选值 |
| `MONEY` | 金额 |
| `COLOR` | 颜色 |
| `UID` | 唯一 ID |
| `BIG_TEXT` | 大文本 |
| `ENCRYPT_TEXT` | 默认使用 scrypt 的密码摘要；可配置为 AES-256-GCM 可逆文本 |
| `JSON_OBJECT` | JSON 对象 |
| `JSON_ARRAY` | JSON 数组 |

字段默认值使用 `default`，可以是固定值或返回默认值的函数：

```typescript
createdAt: {
  code: 'createdAt',
  name: '创建时间',
  columnName: 'created_at',
  type: SysFieldTypeEnum.DATETIME,
  default: () => new Date(),
}
```

## TypeScript 类型

可以为仓库传入实体类型，使查询结果获得完整类型提示。

```typescript
interface User {
  id: string;
  username: string;
  email?: string;
  enabled: boolean;
}

const user = await db.query<User>('user').findOne({
  where: { username: 'alice' },
});
```

`where`/`filters` 的逻辑结构使用 `IWhere`，但字段名和条件值仍是动态类型；模型实体类型暂时不会对 `where`、`select` 和 `populate` 做完整的字段级约束。

## 表结构同步

仓库中包含实验性的 `ModelTableMigrator`，用于根据模型创建和更新表结构。`dryRun()` 会只读取当前模型与历史快照并返回迁移计划，不执行 DDL、建表或写快照。计划中的删列以及字段类型、长度、required 变更会标记为破坏性操作；`syncAll()` 默认拒绝执行此类计划，完成并验证备份后必须显式调用 `syncAll({ allowDestructive: true })`。

`syncAll()` 会在同一事务中读取旧快照、执行全部 DDL，并只在全部成功后保存新快照；失败会回滚并保留旧模型定义。同一进程内，相同 `Database` 实例及指向同一 SQLite 文件的不同实例都会串行迁移，非 SQLite 数据库还会锁定已有快照行。

`lli_model_record` 会记录最近一次迁移的 `ready`/`failed` 状态和截断后的错误信息，也可以通过 `migrator.getMigrationStatus()` 读取。失败原因修复后可再次调用 `syncAll()`。

`ModelTableMigrator` 已从包根入口导出。配置 `canGenerateType: true` 后，成功执行 `syncAll()` 会为 `models` 中的公开模型生成 TypeScript 接口；`appRoot` 默认为当前工作目录，`typeOutDir` 默认为 `src/lli-db-types` 且相对于 `appRoot`。关闭或省略该开关时不会创建类型目录。

```typescript
import { Database, ModelTableMigrator } from '@llii/db';

const db = new Database({
  connection,
  models,
  canGenerateType: true,
  appRoot: process.cwd(),
  typeOutDir: 'src/lli-db-types',
});

const migrator = new ModelTableMigrator(db);
const plan = await migrator.dryRun();
console.log(plan.operations, plan.warnings);

// 无破坏性操作时直接执行；若 plan.requiresBackup 为 true，先备份并验证恢复：
await migrator.syncAll(
  plan.requiresBackup ? { allowDestructive: true } : undefined,
);
```

完整的计划字段、SQLite 备份与失败恢复步骤见 [迁移运维指南](docs/迁移运维指南.md)。当前迁移自动化验证仅覆盖 SQLite；同进程锁不能替代跨进程部署锁，PostgreSQL DDL 与锁行为尚未验证，因此不建议在生产环境无人值守运行。

## Minlet 数据层能力

面向不可信 JSON 输入时，可启用严格校验、revision 乐观锁、keyset cursor 和 SQLite 只读快照。新能力均为显式启用，原有 `coerce`、page/offset 和未启用 revision 的模型保持兼容。

```typescript
const db = new Database({
  connection: {
    client: 'better-sqlite3',
    connection: { filename: './app.sqlite3' },
    useNullAsDefault: true,
    pool: { min: 1, max: 4 },
  },
  models,
  validation: {
    mode: 'strict',
    rejectUnknownFields: true,
    datetimeFormat: 'iso-utc-ms',
  },
  sqlite: {
    journalMode: 'wal',
    foreignKeys: true,
    busyTimeoutMs: 5000,
    synchronous: 'normal',
  },
  readSnapshots: { maxActive: 8, maxLifetimeMs: 300000 },
});
```

模型设置 `useRevision: true` 后会注入 `Revision` 扩展字段，创建生命周期由扩展字段中间件处理，记录从 `revision = 1` 开始。`expectedRevision` 只属于 update/delete 的 `IMutationParams`；其他读写操作传入该字段会抛出 `LLI400`。带 `expectedRevision` 的 update/delete 使用单条条件语句完成比较和修改，条件未命中时抛出 `LLI40901`。`findCursorPage()` 返回未签名的 `nextPosition`；外部 cursor token、身份和权限绑定仍应由调用方完成。

```typescript
const page = await db.query('article').findCursorPage({
  orderBy: [{ field: 'publishedAt', direction: 'desc' }],
  after: previousPosition,
  limit: 50,
});

await db.query('article').update({
  where: { id },
  expectedRevision: 3,
  data: { title: 'new title' },
});
```

强一致翻页可在 WAL 模式的文件型 `better-sqlite3` 数据库上显式打开只读快照，并在 `finally` 中关闭。快照只公开查询方法，底层事务同时启用 SQLite `query_only`。`db.getReadSnapshotStats()` 可查询快照指标，`db.getSqliteRuntimeState()` 可查询实际 pragma 状态。`db.close()` 会拒绝新操作，等待已经进入的 ORM 查询和事务收尾，再关闭快照与连接池。

上线或迁移前可调用 `backup()`、`integrityCheck()` 和 `validateStoredData()`；`syncAll({ validateStoredData: true })` 会在迁移事务提交前执行存量校验。完整契约、限制和恢复顺序见 [Minlet 数据层与 SQLite 运维指南](docs/Minlet数据层与SQLite运维指南.md)。

## 开发

发布前执行 `npm run release:verify`。该门禁会验证测试、构建、tarball、干净临时项目安装、凭据/PII 扫描、CycloneDX SBOM、版本 tag、CHANGELOG、干净工作树和 npm provenance 环境。`npm run package:smoke` 会从当前源码重新构建 tarball，在隔离目录中仅安装生产依赖与 `better-sqlite3`，并执行包入口导入、内存建表、CRUD 和事务回滚。`npm run security:scan` 检查当前工作树和包内容且不会回显命中原文；完整历史使用独立的 `security:scan:history`。当前 Gitee 源地址尚未具备 npm provenance 支持的发布环境，因此正式发布仍处于阻塞状态；不要绕过门禁手工发布。完整说明见 [依赖与发布策略](docs/依赖与发布策略.md)和[安全扫描报告](docs/安全扫描报告.md)。

目标 Electron 完成 `better-sqlite3` ABI 重建后，可运行 `npm run electron:smoke -- <electron-executable>`；也可设置 `LLI_DB_ELECTRON_BINARY`。PostgreSQL 的可选集成契约通过 `LLI_DB_TEST_PG_URL` 启用，未配置时保持跳过且兼容级别仍为 preview。

```bash
# 安装依赖
pnpm install

# 编译
pnpm build

# 类型检查但不生成文件
pnpm typecheck

# 静态检查
pnpm lint

# 运行测试
pnpm test

# 执行完整发布前检查并从干净目录重建 dist
pnpm run prepack

# 检查 npm 包内容但不发布
pnpm run pack:check
```

当前数据库测试只运行 SQLite。每个测试文件会在系统临时目录创建独立数据库，自动同步所需模型并写入固定测试数据；测试结束后关闭连接池并删除临时目录。仓库不跟踪任何 SQLite 数据库文件，测试也不会连接 PostgreSQL 或其他外部数据库。

运行示例时，数据库默认创建为当前目录的 `data.sqlite3`，也可通过 `LLI_DB_EXAMPLE_PATH` 指定本地路径。数据库及其 journal/WAL/SHM 文件均已被 Git 忽略。

`npm publish` 会自动执行 `prepack`，依次清理旧 `dist`、运行类型检查、ESLint 和隔离测试，然后重新构建发布产物。任一步骤失败都会阻止发布。

## 许可证与来源说明

本项目采用 [MIT 许可证](LICENSE)。部分数据库层设计参考 Strapi Community Edition，其中事务上下文实现包含改编代码；原始版权、来源路径及 MIT Expat 条款见 [NOTICE](NOTICE)。本项目的源码复核未发现使用 Strapi `ee/` 目录下的企业版代码。
