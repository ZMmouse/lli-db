# lli-db 面向 Minlet 的能力升级计划

状态 `implemented-with-external-runtime-validation-pending`

更新时间 `2026-09-11`

适用范围 `@llii/db 0.0.16` 之后的能力演进

实施结果：审计指出的仓库内 P0 至 P6 缺口已重新打开并修复，包括 ReadSnapshot 的只读边界、strict 关系/子记录/UID、cursor 位置值精确类型、close drain、快照指标、SQLite pragma 状态查询、WAL/query-only 防线、稳定 integrity 错误码、revision 与逻辑删除、原子 update returning、独立乐观更新类型以及相应迁移/并发/回滚测试。后续复查又补齐了关闭期间的内部重入拒绝、并发快照名额预留、`expectedRevision` 的 mutation-only 契约、快照回滚失败的保留/重试/诊断语义、`returning()` 的前置参数校验、嵌套子记录的逻辑删除与 revision 语义、默认值严格校验、Windows SQLite 迁移锁路径归一化、快照打开清理错误诊断，以及手动事务关闭边界测试。revision 继续作为 `SysExpansionFieldTypeEnum.REVISION` 扩展字段，由写入执行器完成 compare-and-swap。当前等价 `npm run verify` 的各项检查均通过，共 31 个通过的测试套件、274 个通过的测试；另有 1 个 PostgreSQL 集成套件、2 个测试因未配置 `LLI_DB_TEST_PG_URL` 而跳过。Node tarball 消费端验证通过。Electron 最小 ABI smoke 工程和执行命令已经加入，但目标 Electron 可执行文件尚未提供，因此不能把“脚本已实现”写成“目标 ABI 已通过”。

2026-09-11 复查继续补齐了子记录 update 的父级归属校验、子记录 revision 递增、纯关系与纯子记录更新、legacy 展示模式下的无损 DATETIME cursor、strict 模式默认 ISO UTC 毫秒契约、快照打开失败事务的关闭重试，以及备份目标的原子防覆盖。当前完整验证为 31 个通过的测试套件、274 个通过的测试；PostgreSQL 和 Electron 外部环境验证仍不计入完成结论。

## 1. 计划目标

Minlet 需要一套受控的 Data Service。它对外提供 Resource、Schema、CRUD、事务、revision、cursor 和 migration 等协议，对内默认使用每个 App 独立的 SQLite 数据库。

lli-db 已经具备模型驱动建表、CRUD、批量创建、事务、索引、迁移计划、SQLite 驱动兼容检查和结构化诊断。这些能力可以继续作为 Minlet 数据持久化的内部实现。当前缺少的部分主要集中在严格值校验、乐观并发、稳定游标、长生命周期只读快照、SQLite 运行参数和可编程备份检查。

本计划只收录适合作为通用数据库能力进入 lli-db 的工作。App 身份、权限、协议签名和其他 Minlet 产品规则继续由 Minlet Runtime 负责。

## 2. 当前基线

当前代码已经确认具备以下基础能力。

| 能力         | 当前状态                               | 本计划中的处理                         |
| ------------ | -------------------------------------- | -------------------------------------- |
| SQLite       | `better-sqlite3` 已进入完整测试范围    | 保留并增加运行参数和快照验证           |
| PostgreSQL   | 预览支持                               | 新能力先以 SQLite 验收，接口保持可移植 |
| CRUD         | 已提供单条和批量操作                   | 保持兼容                               |
| `createMany` | 主记录、关系和子记录在同一事务中写入   | 增加 Minlet 所需的原子性回归用例       |
| 回调式事务   | 支持自动提交、回滚和异步回调           | 继续作为内部事务原语                   |
| 模型迁移     | 支持 dry run、破坏性操作确认和失败状态 | 增加备份、完整性检查和存量数据校验原语 |
| 分页         | 支持 page、limit 和 offset             | 新增 keyset cursor，不移除旧接口       |
| revision     | 尚未提供                               | 增加可选乐观锁能力                     |
| 只读快照     | 尚未提供                               | 增加显式打开、查询和关闭接口           |
| 值校验       | 默认允许部分类型转换                   | 增加兼容的严格模式                     |
| 生命周期     | 可通过 `db.knex.destroy()` 关闭        | 增加正式的 `db.close()`                |

实施前 `npm run verify` 基线为 25 个测试套件、175 个测试全部通过。实施后基线见本文验收清单和仓库最新验证输出。

## 3. 责任边界

### 3.1 进入 lli-db 的能力

以下能力具有通用数据库价值，应该在 lli-db 中实现。

1. 可选的严格字段值校验。
2. 系统字段和只读字段保护。
3. 基于 revision 的乐观并发控制。
4. 条件更新、条件删除和原子数值递增。
5. 基于稳定排序元组的 keyset cursor 分页。
6. 明确的 null 排序规则和大小写敏感 contains。
7. 长生命周期只读快照的底层原语。
8. 快照超时、关闭和资源统计。
9. SQLite WAL、foreign keys 和 busy timeout 配置。
10. 数据库关闭、备份、完整性检查和恢复前验证接口。
11. 迁移后的存量数据校验原语。
12. 新能力对应的结构化错误和脱敏诊断事件。
13. `better-sqlite3` 消费者依赖与 Electron ABI 兼容说明。

### 3.2 留在 Minlet 的能力

以下内容依赖 Minlet 的产品模型，不进入 lli-db。

1. `appId`、`appInstanceId`、Workspace Session 和调用者身份。
2. Capability Broker、权限审批和 Resource 授权。
3. Minlet 对外的 cursor token、HMAC 签名和防篡改校验。
4. cursor 与 App、Resource、where、sort、limit 的协议绑定。
5. 五分钟有效期这一产品策略。lli-db 只接受调用方传入的安全上限。
6. `PERMISSION_DENIED`、`RESOURCE_CONFLICT` 等 Minlet 错误信封。
7. 每 App 数据库路径、数据库实例注册表和存储配额。
8. `fileRef` 的所属 App 校验与 File Service 联动。
9. Package Migration 图、QuickJS Migration Script 和 Capability Proxy。
10. Package 与 Data staging workspace 的整体复制及原子指针切换。
11. Agent、Workflow、Action 和 Page 的公开 API。

Minlet 只能通过自己的 Data Service Adapter 使用 lli-db。Page、Web、Workflow、Action 和 Agent 都不能获得 `Database`、Knex、Repository 或 QueryBuilder 实例。

## 4. 总体实施顺序

| 阶段 | 内容                              | 依赖     | 完成标志                               |
| ---- | --------------------------------- | -------- | -------------------------------------- |
| P0   | 公共契约和错误模型                | 无       | API 草案、错误码和兼容规则固定         |
| P1   | 严格模式、只读字段和关闭接口      | P0       | 严格模型可以安全承接外部 JSON          |
| P2   | revision 乐观并发                 | P1       | update/delete 并发测试通过             |
| P3   | keyset cursor 分页                | P1       | 插入、删除、重复排序值和 null 用例通过 |
| P4   | SQLite 只读快照                   | P3       | 跨多次调用保持同一读视图并按时释放     |
| P5   | SQLite 运行参数、备份和完整性检查 | P1       | 文件数据库运维测试通过                 |
| P6   | 迁移后存量数据校验                | P1、P5   | 失败迁移不会留下错误快照               |
| P7   | 诊断、打包和发布收口              | P2 至 P6 | 完整验证和消费端 smoke test 通过       |

P2、P3 和 P5 可以在 P1 完成后并行开发。P4 必须建立在 P3 的稳定排序协议上。P6 依赖备份与完整性检查接口已经固定。

## 5. P0 公共契约和错误模型

### 5.1 工作内容

先补齐公共类型，避免实现阶段反复修改调用方式。

建议新增以下类型。

```ts
export type IValidationMode = 'coerce' | 'strict';

export interface IOptimisticMutationOptions {
    expectedRevision?: number;
}

export interface ICursorOrder {
    field: string;
    direction: 'asc' | 'desc';
}

export interface ICursorPageParams extends IParams {
    orderBy: ICursorOrder[];
    limit?: number;
    after?: Record<string, string | number | boolean | null>;
}

export interface ICursorPageResult<T> {
    rows: T[];
    hasMore: boolean;
    nextPosition?: Record<string, string | number | boolean | null>;
}
```

建议为新失败场景增加稳定的 lli-db 错误码。

| 错误码     | 含义                        |
| ---------- | --------------------------- |
| `LLI40020` | 严格字段值校验失败          |
| `LLI40021` | cursor 排序或位置参数不合法 |
| `LLI40901` | revision 乐观锁冲突         |
| `LLI41001` | read snapshot 已关闭或过期  |
| `LLI42901` | read snapshot 数量达到上限  |
| `LLI50020` | SQLite 备份或完整性检查失败 |

错误 detail 只能包含模型 code、字段 code、操作名和安全的数值信息。SQL、bindings、业务数据、密钥、文件内容和完整路径不得进入诊断事件。

### 5.2 兼容要求

现有公开 API 和默认行为保持不变。

- 默认校验模式继续使用 `coerce`。
- 未启用 revision 的模型不增加 revision 列。
- page、limit 和 offset 继续可用。
- 新的 cursor API 使用独立方法，不改变 `queryPage()` 的返回结构。
- 新错误码只用于新能力，现有错误映射不批量改写。

### 5.3 验收

- TypeScript 类型契约通过。
- 包根入口导出全部新增公共类型。
- README 和生成的声明文件保持一致。
- 旧测试无需修改即可继续通过。

## 6. P1 严格模式、只读字段和关闭接口

### 6.1 严格校验模式

在 Database 配置中增加可选项。

```ts
const db = new Database({
    connection,
    models,
    validation: {
        mode: 'strict',
        rejectUnknownFields: true,
    },
});
```

严格模式执行以下规则。

| 字段     | 严格模式规则                                                               |
| -------- | -------------------------------------------------------------------------- |
| TEXT     | 只接受 string                                                              |
| INT      | 只接受安全整数                                                             |
| FLOAT    | 只接受有限 number，拒绝 NaN 和 Infinity                                    |
| SWITCH   | 只接受 boolean                                                             |
| DATETIME | 只接受配置约定的日期字符串或 Date，不做模糊解析                            |
| JSON     | 只接受可序列化 JSON 值，拒绝 undefined、函数、symbol、循环引用和非有限数值 |
| UID      | 由系统生成，调用方不能写入                                                 |

严格模式还要完成以下校验。

- create 检查所有 required 字段。
- update 校验 patch 中的字段，并在需要时校验更新后的最终记录。
- 未声明字段直接报错，不再静默忽略。
- 系统字段、auto 字段和显式只读字段不能由调用方写入。
- 输入校验失败发生在打开写事务之前。

现有字段转换逻辑继续服务 `coerce` 模式。严格模式通过新的校验层实现，避免直接改变 TEXT、FLOAT、SWITCH 和 DATETIME 的历史行为。

### 6.2 ISO UTC datetime

增加明确的 datetime 序列化选项。

```ts
validation: {
  mode: 'strict',
  datetimeFormat: 'iso-utc-ms',
}
```

`iso-utc-ms` 的输出采用类似 `2026-09-11T02:30:15.123Z` 的形式。写入时拒绝无时区、无效日期和超过约定精度的输入。数据库内部采用一种固定表示，读取结果不受操作系统时区影响。

### 6.3 系统字段声明

在模型层增加通用的只读字段元数据，revision 和未来的 auto 字段都复用这一机制。

```ts
interface IBaseAttribute {
    readonly?: boolean;
    generated?: 'create' | 'update' | 'create-update';
}
```

这些元数据只控制数据库写入，不承担 Minlet Schema 的解释工作。

### 6.4 正式关闭接口

增加幂等的关闭方法。

```ts
await db.close();
```

关闭时执行以下动作。

1. 拒绝新的查询和事务。
2. 关闭仍然存在的 read snapshot。
3. 等待已进入收尾阶段的内部操作结束。
4. 销毁 Knex 连接池。
5. 重复调用保持成功。

### 6.5 主要修改位置

- `libs/database/types/database.ts`
- `libs/database/types/model.ts`
- `libs/database/entity-manager/process-data.ts`
- `libs/database/field-type-manager/`
- `libs/database/database.ts`
- `libs/database/error/lli-db-error.ts`

### 6.6 测试

- 字符串数字不能写入 FLOAT。
- 字符串 `false` 不能写入 SWITCH。
- NaN、Infinity、undefined 和循环 JSON 被拒绝。
- 未声明字段被拒绝。
- required、readonly 和 generated 字段规则生效。
- datetime 在不同时区环境中返回相同字符串。
- `db.close()` 关闭快照和连接，多次调用不报错。
- `coerce` 模式保持当前测试结果。

## 7. P2 revision 乐观并发

### 7.1 模型配置

为模型增加可选开关。

```ts
const lesson: IModel = {
    code: 'lesson',
    name: '课程单元',
    tableName: 'lessons',
    useRevision: true,
    attributes: {
        title: {
            code: 'title',
            name: '标题',
            columnName: 'title',
            type: SysFieldTypeEnum.TEXT,
            required: true,
        },
    },
};
```

开启后，模型注册阶段自动添加 revision 系统字段。该字段使用正整数，默认值为 1，调用方不能在 create、createMany 或普通 data 中提供。

### 7.2 更新 API

```ts
const updated = await db.query('lesson').update({
    where: { id: 'lesson_001' },
    data: { title: '深入理解 QKV' },
    expectedRevision: 12,
});
```

数据库写入必须由一条条件更新完成。

```sql
UPDATE lessons
SET title = ?, revision = revision + 1
WHERE id = ? AND revision = ?
RETURNING *
```

调用 `expectedRevision` 时，where 必须包含一个标量 id。禁止把它和任意首条匹配更新组合使用。更新成功后返回的新记录包含递增后的 revision。

未传 `expectedRevision` 时，开启 revision 的模型仍在每次成功更新后递增 revision。这种调用代表 last-write-wins。

一次 update 同时修改普通字段、关系或子记录时，主记录的 revision 更新与其余写入必须处于同一个事务。只修改关系或子记录也要执行一次主记录 revision 递增。后续任一步失败时，主记录 revision 和全部关联写入一起回滚。

### 7.3 删除 API

```ts
await db.query('lesson').delete({
    where: { id: 'lesson_001' },
    expectedRevision: 12,
});
```

删除必须使用单条 `DELETE ... WHERE id = ? AND revision = ?`。受影响行数为零时抛出 `LLI40901`。Minlet Data Service 再根据自己的协议把它映射为 `RESOURCE_CONFLICT`。

传入 expectedRevision 后，目标记录不存在和版本不匹配统一视为乐观锁条件未命中。lli-db 不额外执行一次存在性查询，因为查询结果会再次引入竞争窗口。消费端需要区分不存在时，应在业务流程中先读取记录，并接受读取与后续写入之间仍可能发生变化。

revision 不进入 `updateMany` 和 `deleteMany`。批量乐观锁需要每条记录携带自己的预期版本，后续如有通用需求再设计独立 API。

### 7.4 原子更新原语

为了避免 revision 成为硬编码特例，QueryBuilder 应补齐可测试的条件更新能力。

- update、increment 和 returning 能在同一条语句中执行。
- 返回受影响行数和更新后的记录。
- 不执行先 select 再 update 的竞争窗口。
- SQLite 与 PostgreSQL 分别通过驱动契约验证 returning 行为。

### 7.5 迁移行为

- 旧模型从 `useRevision: false` 升级到 true 时新增非空 revision 列并把已有记录初始化为 1。
- 从 true 改为 false 属于破坏性计划，默认拒绝。
- revision 的列名、类型、默认值和只读属性进入模型快照。

### 7.6 测试

- create 和 createMany 都返回 revision 1。
- 调用方提供 revision 时被拒绝。
- 两个并发更新使用相同 expectedRevision 时只能有一个成功。
- 冲突写入不能修改业务字段或 updatedAt。
- 成功更新恰好递增一次。
- last-write-wins 更新仍递增 revision。
- delete 的版本比较和删除在同一原子语句中发生。
- 未开启 revision 的模型维持原行为。

## 8. P3 keyset cursor 分页

### 8.1 API 形状

新增独立的分页方法。

```ts
const page = await db.query<Lesson>('lesson').findCursorPage({
    where: { courseId: 'course_001' },
    orderBy: [
        { field: 'createdAt', direction: 'desc' },
        { field: 'id', direction: 'asc' },
    ],
    limit: 20,
    after: {
        createdAt: '2026-09-11T02:30:15.123Z',
        id: 'lesson_001',
    },
});
```

返回值保持数据库语义。

```ts
{
  rows: Lesson[]
  hasMore: boolean
  nextPosition?: {
    createdAt: string
    id: string
  }
}
```

lli-db 不编码字符串 token。调用方负责把 `nextPosition`、查询摘要和安全信息包装成自己的协议 cursor。

### 8.2 稳定排序

- orderBy 至少包含一个可排序字段。
- 最终排序必须包含唯一字段。
- 调用方没有提供唯一字段时，lli-db 自动追加 `id asc`。
- 重复排序字段被拒绝。
- JSON、关系和其他不可稳定比较的字段被拒绝。
- `after` 必须包含最终排序中的全部字段，字段和值类型必须匹配。

### 8.3 keyset 条件

多字段 cursor 使用词典序条件。以 `createdAt desc, id asc` 为例，下一页条件等价于下面的表达式。

```sql
created_at < :createdAt
OR (created_at = :createdAt AND id > :id)
```

字段更多时按相同规则展开。实现必须通过参数绑定生成 SQL，不接受表达式字符串和 raw 用户输入。

### 8.4 null 排序

SQLite 和 PostgreSQL 的默认 null 顺序不同。cursor API 必须固定自己的规则，并把规则显式编译到 order by 和 keyset 条件中。

建议采用以下默认值。

| 方向 | null 位置 |
| ---- | --------- |
| asc  | 最后      |
| desc | 最后      |

`nextPosition` 允许 null。跨页时必须覆盖排序字段为 null、重复值和全 null 数据集。

### 8.5 大小写敏感 contains

新增明确的大小写敏感子串操作符，例如 `containsCaseSensitive`。SQLite 实现不能依赖默认 LIKE 行为，可以使用参数化的 `instr(column, value) > 0`。原有 like 和 startsWith 行为不改变。

Minlet Adapter 可以把 `$contains` 映射到该操作符。

### 8.6 测试

- 排序字段有大量重复值时无重复、无遗漏。
- 查询期间新增排在当前 cursor 前面的记录，不影响继续位置。
- 查询期间删除记录时可以正常继续。
- 普通 keyset 查询期间修改排序字段时采用弱一致语义，可能改变该记录在后续页中的位置；文档必须明确这一点。
- asc、desc、混合方向和三字段排序全部覆盖。
- null 排序在 SQLite 中符合固定规则。
- 非法 after、缺字段、额外字段和类型错误被拒绝。
- `hasMore` 为 false 时不返回 nextPosition。
- 大小写敏感 contains 能区分 `A` 和 `a`。
- page/offset 分页回归测试继续通过。

## 9. P4 SQLite 只读快照

### 9.1 使用方式

提供显式的只读快照对象。

```ts
const snapshot = await db.openReadSnapshot({
    maxLifetimeMs: 300_000,
});

try {
    const first = await snapshot.query<Lesson>('lesson').findCursorPage(firstPageParams);

    const second = await snapshot.query<Lesson>('lesson').findCursorPage({
        ...firstPageParams,
        after: first.nextPosition,
    });
} finally {
    await snapshot.close();
}
```

snapshot 只允许 findOne、findMany、count 和 findCursorPage 等读操作。任何写入、DDL、迁移和嵌套事务都立即失败。

### 9.2 生命周期

- 打开时固定一条专用连接和只读事务。
- 第一次读取建立 SQLite read view。
- 后续读取继续使用同一事务。
- close 执行回滚或只读事务结束，并把连接归还连接池。
- 超过 maxLifetimeMs 后自动关闭。
- Database 配置提供最大快照数量和绝对最长生命周期。
- `db.close()` 会关闭全部快照。
- 快照过期或关闭后的任何查询返回 `LLI41001`。

lli-db 返回 snapshot 对象，不返回可跨安全边界传递的 snapshotId。Minlet 如需跨 IPC 请求继续使用快照，应在自己的进程内保存 `snapshotId → snapshot object` 映射。

### 9.3 SQLite 要求

长读事务需要 WAL 模式才能尽量避免阻塞正常写入。测试必须观察以下行为。

- 快照打开后发生的新写入在该快照中不可见。
- 普通查询可以看到新写入。
- 快照不阻止正常短写事务完成。
- 快照结束后 WAL 可以正常 checkpoint。
- 达到数量上限时拒绝继续创建。
- 进程异常后的数据库重新打开不依赖内存快照状态。

### 9.4 风险控制

长读事务会延迟 WAL 清理。lli-db 必须暴露当前快照数量、最老快照年龄和自动关闭次数等脱敏指标。调用方应设置较小的并发上限，不能把 snapshot 当成普通页面会话长期保存。

## 10. P5 SQLite 运行参数、备份和完整性检查

### 10.1 SQLite 配置

增加经过校验的数据库配置，避免每个消费端自行执行 raw pragma。

```ts
sqlite: {
  journalMode: 'wal',
  foreignKeys: true,
  busyTimeoutMs: 5_000,
  synchronous: 'normal',
}
```

配置只在 SQLite 驱动下生效。未知值或与驱动不兼容的组合在初始化阶段失败。初始化后提供只读状态查询，以便测试确认实际 pragma 与请求一致。

### 10.2 备份接口

新增面向文件数据库的备份原语。

```ts
const result = await db.backup({
    destination: backupPath,
    overwrite: false,
    verify: true,
});
```

接口要求如下。

- 默认禁止覆盖已有文件。
- 目标先写入同目录临时文件；默认模式通过原子 no-clobber 硬链接发布，`overwrite: true` 才执行受控替换。
- 使用 SQLite 官方可用的在线备份能力，不能在活动连接存在时直接复制单个 db 文件。
- verify 为 true 时，在隔离连接中执行完整性检查。
- 失败时清理临时文件，不修改源数据库。
- 返回备份大小、完成时间和校验状态，不返回业务内容。

### 10.3 完整性检查

```ts
const result = await db.integrityCheck({ quick: false });
```

返回结构化结果。SQLite 可以映射到 `quick_check` 或 `integrity_check`。其他驱动没有等价能力时返回明确的不支持错误，不能伪造成功。

### 10.4 恢复边界

lli-db 提供备份和校验原语，不直接覆盖正在使用的源数据库。恢复需要消费端先关闭 Database，再在明确的数据目录中切换文件。Minlet 的 staging workspace 和 Package 指针切换继续留在 Minlet Runtime。

### 10.5 测试

- WAL 模式下的在线备份可以被重新打开并读取。
- 备份时发生写入，结果仍是一个一致的数据库状态。
- 已存在目标且 overwrite 为 false 时不修改目标。
- 目标在备份过程中被其他进程创建时不覆盖竞态文件。
- 人工损坏的副本不能通过完整性检查。
- 备份失败不残留临时文件。
- SQLite pragma 与连接池中新建连接保持一致。

## 11. P6 迁移后存量数据校验

### 11.1 校验接口

增加按当前模型扫描存量记录的通用能力。

```ts
const report = await db.validateStoredData({
    models: ['lesson', 'course'],
    batchSize: 500,
    stopAfterErrors: 100,
});
```

报告只包含模型、字段、记录 id、错误类别和计数。默认不包含完整记录和值。

校验范围包括以下内容。

- required 字段为空。
- 字段值不能通过严格类型校验。
- revision 缺失、不是正整数或超出安全范围。
- JSON 反序列化失败。
- datetime 不符合选定格式。
- 唯一索引和关系约束由数据库负责，报告只汇总驱动结果。

### 11.2 与迁移器的关系

`ModelTableMigrator` 增加可选的迁移后校验步骤。执行顺序如下。

```text
生成计划
执行 DDL
保存候选模型快照
扫描存量数据
校验通过后提交事务
```

校验失败时回滚 DDL 和候选模型快照。备份仍由调用方显式创建，迁移器不能因为存在 backup API 就自动覆盖调用方的升级策略。

Minlet 每条 Migration edge 的完整 Schema 校验由 Minlet Migration Runtime 调用 `validateStoredData()` 完成。迁移链、脚本执行和 staging workspace 不进入 ModelTableMigrator。

### 11.3 测试

- 新增 required 字段时发现旧记录缺值。
- revision 初始化完成后全量校验通过。
- 非法 JSON 和 datetime 被定位到模型、字段和 id。
- 达到 stopAfterErrors 后停止并返回截断标记。
- 校验失败后模型快照和表结构保持旧状态。

## 12. P7 诊断、打包和发布收口

### 12.1 新诊断事件

建议增加以下事件。

```text
revision:conflict
cursor:page:start
cursor:page:success
cursor:page:error
snapshot:open
snapshot:close
snapshot:expire
snapshot:limit
backup:start
backup:success
backup:error
integrity-check:start
integrity-check:success
integrity-check:error
stored-data-validation:start
stored-data-validation:success
stored-data-validation:error
```

事件遵守当前脱敏原则。cursor position、查询值、业务字段值、SQL、bindings 和绝对文件路径不能写入事件。

### 12.2 驱动与消费端依赖

厘清 `better-sqlite3` 的包关系。

- lli-db 继续允许不同数据库驱动。
- README 明确 SQLite 消费端必须安装受支持版本的 `better-sqlite3`。
- 可以通过 optional peer dependency 表达驱动关系，避免 PostgreSQL 用户被迫安装 SQLite native module。
- package smoke test 继续从干净临时项目安装生产依赖。
- 增加一个 Electron 消费端 smoke test，验证目标 Electron 版本下的 native ABI 重建、加载、建表、CRUD、事务和关闭。

仓库提供 `npm run electron:smoke -- <electron-executable>`，也可通过 `LLI_DB_ELECTRON_BINARY` 指定目标 Electron。该 smoke 会验证 native module 加载、建表、CRUD、revision、cursor、事务和关闭；依赖的 ABI 重建仍由消费端在调用前完成。

Electron 打包工具链属于消费端。lli-db 只维护兼容矩阵和最小验证工程，不绑定 Minlet 的打包配置。

### 12.3 发布门禁

在现有 verify 基础上增加以下任务。

```text
strict-validation contract
revision concurrency contract
cursor pagination contract
snapshot lifecycle contract
SQLite backup and integrity contract
stored data validation contract
Electron consumer smoke contract
```

发布前仍须通过 typecheck、类型契约、lint、完整测试、构建、tarball 检查、隔离安装、安全扫描、SBOM 和发布元数据检查。

## 13. Minlet Adapter 的预期接法

lli-db 完成上述升级后，Minlet Data Service 的调用关系如下。

```text
PlatformOperation
        ↓
Minlet Data Service
        ↓
权限与 Resource Schema 校验
        ↓
Minlet Query Compiler
        ↓
Minlet lli-db Adapter
        ↓
Database / Repository / ReadSnapshot
        ↓
每 App 独立 SQLite
```

几个关键映射如下。

| Minlet                 | lli-db                              |
| ---------------------- | ----------------------------------- |
| Resource Schema        | 编译为 strict IModel                |
| `data.create`          | Repository create                   |
| `data.createMany`      | Repository createMany               |
| `data.update` revision | expectedRevision                    |
| `data.delete` revision | expectedRevision                    |
| `data.query`           | findCursorPage                      |
| Minlet cursor          | 签名封装 nextPosition 和 snapshotId |
| Migration 全量验证     | validateStoredData                  |
| `RESOURCE_CONFLICT`    | 映射 `LLI40901`                     |
| structured diagnostics | 映射 lli-db 脱敏事件                |

普通 keyset cursor 不保证跨多次请求看到完全相同的数据集合。Minlet 需要强一致分页时，在自己的 cursor registry 中关联一个 lli-db ReadSnapshot。普通 UI 查询是否使用快照由 Minlet 协议决定，lli-db 不自行推断。

## 14. 完整验收清单

### 14.1 向后兼容

- [x] 现有 25 个测试套件和 175 个测试继续通过，并扩展为 31 个通过套件、274 个通过测试。
- [x] 默认 `coerce` 模式行为不变。
- [x] 未启用 revision 的模型结构和返回值不变。
- [x] page 和 offset API 不变。
- [x] PostgreSQL 预览状态没有被误写为正式支持。

### 14.2 严格模型

- [x] unknown、readonly、generated 和 required 字段规则可执行。
- [x] number、boolean、datetime 和 JSON 不发生隐式宽松转换。
- [x] ISO UTC datetime 不受机器时区影响。
- [x] strict 错误不包含业务值。
- [x] UID、多引用、子记录、循环 JSON、function 和 symbol 边界均有测试。

### 14.3 revision

- [x] create/createMany 从 1 开始。
- [x] update 的比较、修改和递增由单条原子语句完成。
- [x] delete 的比较和删除由单条原子语句完成。
- [x] 并发竞争只有一个请求成功。
- [x] 冲突时业务数据和 revision 保持不变。
- [x] revision 与逻辑删除兼容，关系/子记录写入失败会回滚主记录和 revision。
- [x] revision 开关迁移覆盖旧记录初始化为 1，以及移除时的破坏性变更识别。
- [x] `expectedRevision` 只进入 update/delete 的 mutation 参数，其他操作会拒绝该字段。

### 14.4 cursor

- [x] 最终排序拥有唯一键。
- [x] 多字段、混合方向、重复值和 null 都能稳定翻页。
- [x] nextPosition 不包含未声明字段。
- [x] 删除 cursor 行、修改排序字段、三字段排序和 after 精确类型均有覆盖。
- [x] lli-db 不编码 Minlet token，也不保存 App 权限信息。

### 14.5 snapshot

- [x] 同一 snapshot 看不到打开后的新写入。
- [x] 普通查询能看到新写入。
- [x] snapshot 超时、手动关闭和 db.close 都能释放连接。
- [x] 数量上限和最长生命周期不可绕过。
- [x] WAL reader 与 truncate checkpoint 行为有自动化测试。
- [x] snapshot 不公开 Database/run，且写入、raw DDL 和嵌套事务均被只读边界拒绝。
- [x] 当前快照数、最老快照年龄和自动关闭次数可查询。
- [x] 并发打开 snapshot 时会先预留名额，实际活动数不会越过 `maxActive`。
- [x] 自动关闭回滚失败时保留快照状态、不虚增计数、发出脱敏错误并允许重试。

### 14.6 运维

- [x] SQLite pragma 在全部池连接中一致。
- [x] SQLite pragma 实际运行状态可通过只读 API 查询。
- [x] db.close 会等待已经进入的 ORM 查询和事务完成，并拒绝操作内部关闭重入。
- [x] returning 使用模型字段 code，非法空列表、重复字段和通配符混用在执行前失败。
- [x] 在线备份可以独立打开，并覆盖并发写入场景。
- [x] 人工损坏数据库不能通过 integrity check。
- [x] 存量数据校验可以分批、限错并输出脱敏报告。
- [x] required 字段升级校验失败会回滚 DDL 和候选模型快照。
- [ ] PostgreSQL cursor null 与 returning 集成套件在目标 PostgreSQL 上通过（套件已加入，需配置 `LLI_DB_TEST_PG_URL`）。
- [ ] Electron native ABI smoke test 通过。

## 15. 完成定义

整个计划完成需要同时满足以下条件。

1. 新增 API、错误码和兼容规则已经写入 README 与对应专题文档。
2. 每项能力都有正常、边界、并发、失败和资源释放测试。
3. SQLite 完整契约通过，PostgreSQL 未验证部分继续明确标记为预览。
4. 打包后的消费端能够加载 `better-sqlite3`，完成建表、CRUD、revision、cursor、事务和关闭。
5. Minlet 可以只通过 Adapter 完成 Data Service，不需要访问 raw Knex 或 SQLite 文件。
6. Minlet 专属身份、权限、token、迁移脚本和 staging 逻辑没有进入 lli-db。

这份计划完成以后，lli-db 可以稳定承担 Minlet 的数据库执行层。Minlet Runtime 仍然保留 Data Service 协议、安全边界和 App 生命周期的最终控制权。
