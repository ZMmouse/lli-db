import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import knex from 'knex';
import { Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IDiagnosticEvent, IModel } from '../libs';

const model: IModel = {
    code: 'backupRecord',
    name: 'backup record',
    tableName: 'backup_record',
    attributes: {
        title: {
            code: 'title',
            name: 'title',
            columnName: 'title',
            type: SysFieldTypeEnum.TEXT,
            required: true,
        },
    },
};

const createDatabase = async (events?: IDiagnosticEvent[]) => {
    const directory = mkdtempSync(join(tmpdir(), 'lli-db-backup-'));
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: join(directory, 'source.sqlite3') },
            useNullAsDefault: true,
            pool: { min: 1, max: 2 },
        },
        models: [model],
        sqlite: { journalMode: 'wal', busyTimeoutMs: 1_000 },
        diagnostics: events
            ? {
                  onEvent: (event) => {
                      events.push(event);
                  },
              }
            : undefined,
    });
    await new ModelTableMigrator(db).syncAll();
    await db.query('backupRecord').create({ data: { title: 'preserved' } });
    return { db, directory };
};

describe('SQLite backup and integrity operations', () => {
    test('creates and verifies a readable online backup', async () => {
        const events: IDiagnosticEvent[] = [];
        const { db, directory } = await createDatabase(events);
        const destination = join(directory, 'backup.sqlite3');
        try {
            const [result] = await Promise.all([
                db.backup({ destination, verify: true }),
                db.query('backupRecord').create({ data: { title: 'concurrent-write' } }),
            ]);
            expect(result).toMatchObject({ destination, verified: true });
            expect(result.size).toBeGreaterThan(0);
            expect(events.map((event) => event.type)).toEqual(
                expect.arrayContaining(['backup:start', 'backup:success']),
            );

            const backup = knex({
                client: 'better-sqlite3',
                connection: { filename: destination },
                useNullAsDefault: true,
            });
            try {
                const rows = await backup('backup_record').select('title');
                expect(rows).toContainEqual({ title: 'preserved' });
                expect(rows.every((row) => ['preserved', 'concurrent-write'].includes(row.title))).toBe(
                    true,
                );
            } finally {
                await backup.destroy();
            }
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('does not overwrite unless explicitly requested', async () => {
        const events: IDiagnosticEvent[] = [];
        const { db, directory } = await createDatabase(events);
        const destination = join(directory, 'backup.sqlite3');
        writeFileSync(destination, 'existing');
        try {
            await expect(db.backup({ destination })).rejects.toMatchObject({ code: 'LLI400' });
            expect(events.map((event) => event.type)).toEqual(
                expect.arrayContaining(['backup:start', 'backup:error']),
            );
            await expect(db.backup({ destination, overwrite: true })).resolves.toMatchObject({
                destination,
            });
            expect(existsSync(destination)).toBe(true);
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('returns a structured integrity result', async () => {
        const events: IDiagnosticEvent[] = [];
        const { db, directory } = await createDatabase(events);
        try {
            await expect(db.integrityCheck()).resolves.toEqual({ ok: true, messages: ['ok'] });
            await expect(db.integrityCheck({ quick: true })).resolves.toEqual({
                ok: true,
                messages: ['ok'],
            });
            expect(events.map((event) => event.type)).toEqual(
                expect.arrayContaining(['integrity-check:start', 'integrity-check:success']),
            );
        } finally {
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('removes a partial temporary backup after failure', async () => {
        const { db, directory } = await createDatabase();
        const destination = join(directory, 'failed.sqlite3');
        const acquire = jest.spyOn(db.knex.client, 'acquireConnection').mockResolvedValue({
            backup: async (temporary: string) => {
                writeFileSync(temporary, 'partial');
                throw new Error('simulated backup failure');
            },
        });
        const release = jest.spyOn(db.knex.client, 'releaseConnection').mockResolvedValue(undefined);
        try {
            await expect(db.backup({ destination })).rejects.toMatchObject({ code: 'LLI50020' });
            expect(readdirSync(directory).some((name) => name.startsWith('failed.sqlite3.tmp-'))).toBe(
                false,
            );
        } finally {
            acquire.mockRestore();
            release.mockRestore();
            await db.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('does not report an artificially corrupted database as healthy', async () => {
        const { db, directory } = await createDatabase();
        const destination = join(directory, 'corrupt.sqlite3');
        await db.backup({ destination });
        await db.close();
        writeFileSync(destination, 'not a sqlite database');
        const corrupted = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: destination },
                useNullAsDefault: true,
            },
            models: [model],
        });
        try {
            await expect(corrupted.integrityCheck()).rejects.toBeDefined();
        } finally {
            await corrupted.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });
});
