import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IDiagnosticEvent, IModel } from '../libs';

const model: IModel = {
    code: 'snapshotRecord',
    name: 'snapshot record',
    tableName: 'snapshot_record',
    attributes: {
        rank: {
            code: 'rank',
            name: 'rank',
            columnName: 'rank_value',
            type: SysFieldTypeEnum.INT,
            required: true,
        },
    },
};

const createDatabase = async (
    maxActive = 2,
    maxLifetimeMs = 5_000,
    events?: IDiagnosticEvent[],
) => {
    const directory = mkdtempSync(join(tmpdir(), 'lli-db-snapshot-'));
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: join(directory, 'data.sqlite3') },
            useNullAsDefault: true,
            pool: { min: 1, max: 3 },
        },
        models: [model],
        validation: { mode: 'strict' },
        readSnapshots: { maxActive, maxLifetimeMs },
        sqlite: {
            journalMode: 'wal',
            foreignKeys: true,
            busyTimeoutMs: 1_000,
            synchronous: 'normal',
        },
        diagnostics: events
            ? {
                  onEvent: (event) => {
                      events.push(event);
                  },
              }
            : undefined,
    });
    await new ModelTableMigrator(db).syncAll();
    await db.query('snapshotRecord').createMany({
        data: [{ rank: 1 }, { rank: 2 }, { rank: 3 }],
    });
    return { db, directory };
};

describe('SQLite read snapshots', () => {
    test('keeps one read view while ordinary queries observe later writes', async () => {
        const { db, directory } = await createDatabase();
        try {
            const snapshot = await db.openReadSnapshot();
            const first = await snapshot.query<{ rank: number }>('snapshotRecord').findCursorPage({
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
            });
            await db.query('snapshotRecord').create({ data: { rank: 4 } });

            const snapshotRows = await snapshot
                .query<{ rank: number }>('snapshotRecord')
                .findMany({ orderBy: { rank: 'asc' } });
            const ordinaryRows = await db
                .query<{ rank: number }>('snapshotRecord')
                .findMany({ orderBy: { rank: 'asc' } });
            expect(first.rows.map((row) => row.rank)).toEqual([1, 2]);
            expect(snapshotRows.map((row) => row.rank)).toEqual([1, 2, 3]);
            expect(ordinaryRows.map((row) => row.rank)).toEqual([1, 2, 3, 4]);
            await snapshot.close();
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('exposes only read methods and rejects writes or nested transactions', async () => {
        const { db, directory } = await createDatabase();
        try {
            const snapshot = await db.openReadSnapshot();
            expect(snapshot).not.toHaveProperty('database');
            expect(snapshot).not.toHaveProperty('run');

            db.middlewareManager.registerGlobalMiddleware('findMany', async (ctx, next) => {
                await ctx.db.createQueryBuilder('snapshotRecord').insert({ rank: 99 }).execute();
                await next();
            });
            await expect(snapshot.query('snapshotRecord').findMany()).rejects.toMatchObject({
                code: 'LLI41002',
            });
            await snapshot.close();

            const ddl = await db.openReadSnapshot();
            db.middlewareManager.registerGlobalMiddleware('findOne', async (ctx, next) => {
                await ctx.db.knex.raw('CREATE TABLE forbidden_in_snapshot (id TEXT)');
                await next();
            });
            await expect(ddl.query('snapshotRecord').findOne()).rejects.toMatchObject({
                code: 'SQLITE_READONLY',
            });
            await ddl.close();
            await expect(db.knex.schema.hasTable('forbidden_in_snapshot')).resolves.toBe(false);

            const nested = await db.openReadSnapshot();
            db.middlewareManager.registerGlobalMiddleware('count', async (ctx, next) => {
                await new ModelTableMigrator(ctx.db).syncAll();
                await next();
            });
            await expect(nested.query('snapshotRecord').count()).rejects.toMatchObject({
                code: 'LLI41002',
            });
            await nested.close();
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('enforces active snapshot and lifetime limits', async () => {
        const events: IDiagnosticEvent[] = [];
        const { db, directory } = await createDatabase(1, 50, events);
        try {
            const snapshot = await db.openReadSnapshot({ maxLifetimeMs: 30 });
            const now = jest.spyOn(Date, 'now').mockReturnValue(snapshot.openedAt + 25);
            expect(db.getReadSnapshotStats()).toMatchObject({
                activeCount: 1,
                oldestAgeMs: 25,
                autoClosedCount: 0,
            });
            now.mockRestore();
            await expect(db.openReadSnapshot()).rejects.toMatchObject({ code: 'LLI42901' });
            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(() => snapshot.query('snapshotRecord')).toThrow(
                expect.objectContaining({ code: 'LLI41001' }),
            );
            expect(db.getReadSnapshotStats()).toEqual({
                activeCount: 0,
                oldestAgeMs: 0,
                autoClosedCount: 1,
            });
            const replacement = await db.openReadSnapshot();
            await replacement.close();
            expect(events.map((event) => event.type)).toEqual(
                expect.arrayContaining([
                    'snapshot:open',
                    'snapshot:limit',
                    'snapshot:expire',
                    'snapshot:close',
                ]),
            );
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('applies configured SQLite pragmas', async () => {
        const { db, directory } = await createDatabase();
        try {
            await expect(db.getSqliteRuntimeState()).resolves.toEqual({
                journalMode: 'wal',
                foreignKeys: true,
                busyTimeoutMs: 1000,
                synchronous: 'normal',
                queryOnly: false,
            });
            const connections = await Promise.all([
                db.knex.client.acquireConnection(),
                db.knex.client.acquireConnection(),
                db.knex.client.acquireConnection(),
            ]);
            try {
                for (const connection of connections) {
                    expect(connection.pragma('journal_mode', { simple: true })).toBe('wal');
                    expect(connection.pragma('foreign_keys', { simple: true })).toBe(1);
                    expect(connection.pragma('busy_timeout', { simple: true })).toBe(1000);
                    expect(connection.pragma('synchronous', { simple: true })).toBe(1);
                }
            } finally {
                await Promise.all(
                    connections.map((connection) => db.knex.client.releaseConnection(connection)),
                );
            }
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('database close releases open snapshots', async () => {
        const { db, directory } = await createDatabase();
        const snapshot = await db.openReadSnapshot();
        await db.close();
        expect(() => snapshot.query('snapshotRecord')).toThrow(
            expect.objectContaining({ code: 'LLI41001' }),
        );
        rmSync(directory, { recursive: true, force: true });
    });

    test('database close drains an operation that already entered middleware', async () => {
        const { db, directory } = await createDatabase();
        let entered!: () => void;
        let release!: () => void;
        const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
        const releasePromise = new Promise<void>((resolve) => (release = resolve));
        db.middlewareManager.registerGlobalMiddleware('findMany', async (_ctx, next) => {
            entered();
            await releasePromise;
            await next();
        });

        const queryPromise = db.query('snapshotRecord').findMany();
        await enteredPromise;
        let closed = false;
        const closePromise = db.close().then(() => {
            closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        release();
        await expect(queryPromise).resolves.toHaveLength(3);
        await closePromise;
        expect(() => db.query('snapshotRecord')).toThrow(
            expect.objectContaining({ code: 'LLI41000' }),
        );
        rmSync(directory, { recursive: true, force: true });
    });

    test('database close also drains a directly opened callback transaction', async () => {
        const { db, directory } = await createDatabase();
        let entered!: () => void;
        let release!: () => void;
        const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
        const releasePromise = new Promise<void>((resolve) => (release = resolve));
        const transactionPromise = db.transaction(async () => {
            entered();
            await releasePromise;
            await db.knex('snapshot_record').where({ id: 'missing' }).select();
        });
        await enteredPromise;
        let closed = false;
        const closePromise = db.close().then(() => {
            closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        release();
        await transactionPromise;
        await closePromise;
        expect(closed).toBe(true);
        rmSync(directory, { recursive: true, force: true });
    });

    test('releases the WAL reader so a truncate checkpoint can finish', async () => {
        const { db, directory } = await createDatabase();
        try {
            const snapshot = await db.openReadSnapshot();
            await snapshot.query('snapshotRecord').findMany();
            await db.query('snapshotRecord').createMany({
                data: Array.from({ length: 100 }, (_, index) => ({ rank: index + 10 })),
            });

            const active = await db.knex.raw('PRAGMA wal_checkpoint(PASSIVE)');
            expect(active[0].log).toBeGreaterThan(active[0].checkpointed);

            await snapshot.close();
            const released = await db.knex.raw('PRAGMA wal_checkpoint(TRUNCATE)');
            expect(released[0]).toMatchObject({ busy: 0, log: 0, checkpointed: 0 });
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('rejects unsupported and unsafe snapshot configurations before use', async () => {
        expect(
            () =>
                new Database({
                    connection: {
                        client: 'sqlite3',
                        connection: { filename: 'unused.sqlite3' },
                    },
                    models: [model],
                    readSnapshots: { maxActive: 1 },
                }),
        ).toThrow(expect.objectContaining({ code: 'LLI400' }));

        expect(
            () =>
                new Database({
                    connection: {
                        client: 'better-sqlite3',
                        connection: { filename: 'unused.sqlite3' },
                    },
                    models: [model],
                    sqlite: { journalMode: 'unsafe' } as never,
                }),
        ).toThrow(expect.objectContaining({ code: 'LLI400' }));

        const memory = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            },
            models: [model],
        });
        try {
            await expect(memory.openReadSnapshot()).rejects.toMatchObject({ code: 'LLI400' });
        } finally {
            await memory.close();
        }
    });
});
