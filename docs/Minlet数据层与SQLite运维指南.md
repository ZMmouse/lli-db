# Minlet 数据层与 SQLite 运维指南

状态：已实现，适用于 `@llii/db 0.0.16` 之后的未发布版本。

## 1. 责任边界

lli-db 提供通用数据库原语：严格值校验、revision 乐观锁、keyset cursor、只读快照、SQLite 运行参数、在线备份、完整性检查和存量数据校验。

Minlet 仍负责 App 身份与权限、Resource Schema 到 lli-db 模型的编译、cursor token 的签名和有效期、每 App 数据库路径、`fileRef` 授权、Migration 图与 staging workspace。外部执行环境不应直接获得 `Database`、Repository、Knex 或 SQLite 文件。

## 2. 推荐配置

```ts
const db = new Database({
    connection: {
        client: 'better-sqlite3',
        connection: { filename: appDatabasePath },
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
    readSnapshots: {
        maxActive: 8,
        maxLifetimeMs: 300000,
    },
});
```

`sqlite` 和 `readSnapshots` 配置目前只接受 `better-sqlite3`。pragma 的枚举和数值会在运行时校验，避免 JavaScript 调用方绕过 TypeScript 类型。只读快照要求文件型 SQLite；`:memory:` 不可用，因为连接池中的连接不共享同一个内存数据库。

## 3. 严格写入

`validation.mode = 'strict'` 禁止 number、boolean、datetime 和 JSON 的隐式宽松转换。`rejectUnknownFields` 拒绝模型外字段。`readonly` 与 `generated` 字段不允许调用方写入；系统生成的 id、时间戳和 revision 同样受保护。

默认仍是 `coerce`，便于旧调用方平滑迁移。建议先对现有数据执行 `validateStoredData()`，修正数据后再打开严格模式。

模型默认值（包括函数返回值）与调用方显式传值共用同一套严格校验和数据库转换流程。默认值类型错误会在插入前以 `LLI40020` 拒绝，不会把非法值写入数据库。

## 4. revision 乐观并发

模型声明：

```ts
const article = {
    code: 'article',
    tableName: 'articles',
    name: '文章',
    useRevision: true,
    attributes: {
        /* ... */
    },
};
```

`useRevision` 会向模型注入 `SysExpansionFieldTypeEnum.REVISION` 扩展字段。运行时创建、批量创建和子记录初始化由扩展字段中间件统一处理，数据库默认值同时为 DDL 和旧数据迁移提供兜底。创建记录时 revision 为 1。更新和删除必须把客户端读到的版本作为 `expectedRevision` 传回：

```ts
await db.query('article').update({
    where: { id: articleId },
    expectedRevision: currentRevision,
    data: patch,
});
```

比较、业务修改和 revision 递增由单条条件更新完成。冲突抛出 `LLI40901`，Minlet 可将其映射为 `RESOURCE_CONFLICT`。为避免“先查再改”的竞态，底层不区分记录不存在和 revision 不匹配；需要区分时由 Minlet 在冲突后重新查询。

父记录嵌套更新中的子记录删除也遵循子模型的逻辑删除和 revision 规则，并递归清理后代关系。删除前会同时校验子记录 id 与父引用，不能借由其他父记录的嵌套载荷删除不属于当前父记录的数据。

## 5. cursor 与快照

```ts
const page = await db.query('article').findCursorPage({
    where: { status: 'published' },
    orderBy: [
        { field: 'publishedAt', direction: 'desc' },
        { field: 'priority', direction: 'asc' },
    ],
    after: decodedPosition,
    limit: 50,
});
```

lli-db 自动追加 `id asc` 作为唯一尾键，按排序元组构造 keyset 条件，并固定 null-last 语义。`nextPosition` 只是结构化位置，不包含签名、权限或有效期；Minlet 必须将 App、Resource、where、sort、limit 与 snapshot 标识一起签名。

普通 cursor 是弱一致查询。需要跨页强一致时：

```ts
const snapshot = await db.openReadSnapshot({ maxLifetimeMs: 120000 });
try {
    const page = await snapshot.query('article').findCursorPage(params);
} finally {
    await snapshot.close();
}
```

快照占用一个池连接并可能延迟 WAL checkpoint，因此必须限制数量和最长生命周期。快照要求数据库实际运行在 WAL 模式，并在快照事务上启用 SQLite `query_only`；对象本身不公开 Database、通用 run 或事务入口。`db.getReadSnapshotStats()` 可查询当前快照数、最老快照年龄和自动关闭次数。`db.close()` 会先拒绝新操作，等待已经进入的 ORM 查询和事务收尾，再关闭仍存活的快照并销毁连接池。

初始化后可通过 `await db.getSqliteRuntimeState()` 只读查询实际的 `journalMode`、`foreignKeys`、`busyTimeoutMs`、`synchronous` 和 `queryOnly`，用于启动验收和诊断，避免消费端自行执行 raw pragma。

## 6. 备份、检查与迁移

建议升级顺序：

1. 暂停目标 App 的新写入或进入维护状态。
2. `db.backup({ destination, verify: true })` 创建临时备份、验证后原子改名。
3. `db.integrityCheck()` 检查源库；结果非 `ok` 时停止升级。
4. `migrator.dryRun()` 审阅变更；破坏性变更必须显式确认。
5. `migrator.syncAll({ allowDestructive, validateStoredData: true })`。
6. 必要时再次执行 `validateStoredData()`，然后恢复服务。

备份默认不覆盖已有文件；只有 `overwrite: true` 才允许替换。存量校验按批读取，报告只含 model、field、record id 和原因，不含业务值：

```ts
const report = await db.validateStoredData({
    models: ['article'],
    batchSize: 500,
    stopAfterErrors: 100,
});
```

校验失败时，`syncAll()` 会回滚当前迁移事务并保留旧模型快照。Minlet 的多版本 Migration 脚本、staging 副本和原子指针切换不属于 lli-db。

## 7. 诊断与错误映射

新增事件覆盖 revision 冲突、cursor、snapshot、backup、integrity check 和 stored-data validation。事件不会记录 SQL、bindings、查询值、cursor position、业务字段值或绝对文件路径。

建议映射：

| lli-db     | Minlet                 |
| ---------- | ---------------------- |
| `LLI400`   | 参数或 Schema 错误     |
| `LLI40901` | `RESOURCE_CONFLICT`    |
| `LLI41000` | Database 已关闭        |
| `LLI41001` | Snapshot 已关闭或过期  |
| `LLI42901` | Snapshot 数量达到上限  |
| `LLI50020` | 备份或迁移数据校验失败 |

## 8. Electron 与 native ABI

SQLite 消费端必须安装兼容版本的 `better-sqlite3`；包将其声明为 optional peer dependency，PostgreSQL 用户不会被强制安装 native 模块。

Electron 应用必须针对目标 Electron ABI 重建 `better-sqlite3`，并在最终打包产物中验证：加载模块、打开文件库、迁移、CRUD、revision、cursor、事务回滚和 `db.close()`。仓库提供 `npm run electron:smoke -- <electron-executable>`（或设置 `LLI_DB_ELECTRON_BINARY`）作为最小验证工程。具体 Electron 版本与打包器由 Minlet 消费端决定，因此脚本存在或 Node tarball smoke 成功都不能替代目标 Electron 产物验证。
