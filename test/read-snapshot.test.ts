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

    test('enforces active snapshot and lifetime limits', async () => {
        const events: IDiagnosticEvent[] = [];
        const { db, directory } = await createDatabase(1, 50, events);
        try {
            const snapshot = await db.openReadSnapshot({ maxLifetimeMs: 30 });
            await expect(db.openReadSnapshot()).rejects.toMatchObject({ code: 'LLI42901' });
            await new Promise((resolve) => setTimeout(resolve, 60));
            expect(() => snapshot.query('snapshotRecord')).toThrow(
                expect.objectContaining({ code: 'LLI41001' }),
            );
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
                    connections.map((connection) =>
                        db.knex.client.releaseConnection(connection),
                    ),
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
