import { Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

const model: IModel = {
    code: 'validatedRecord',
    name: 'validated record',
    tableName: 'validated_record',
    useRevision: true,
    attributes: {
        title: {
            code: 'title',
            name: 'title',
            columnName: 'title',
            type: SysFieldTypeEnum.TEXT,
            required: true,
        },
        score: {
            code: 'score',
            name: 'score',
            columnName: 'score',
            type: SysFieldTypeEnum.FLOAT,
        },
        occurredAt: {
            code: 'occurredAt',
            name: 'occurred at',
            columnName: 'occurred_at',
            type: SysFieldTypeEnum.DATETIME,
        },
        payload: {
            code: 'payload',
            name: 'payload',
            columnName: 'payload',
            type: SysFieldTypeEnum.JSON,
        },
    },
};

const createDatabase = async () => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models: [model],
        validation: { mode: 'strict', datetimeFormat: 'iso-utc-ms' },
    });
    await new ModelTableMigrator(db).syncAll();
    return db;
};

describe('stored data validation', () => {
    test('accepts data written through a strict repository', async () => {
        const db = await createDatabase();
        try {
            await db.query('validatedRecord').create({
                data: {
                    title: 'valid',
                    score: 1.5,
                    occurredAt: '2026-09-11T02:30:15.123Z',
                    payload: { ok: true },
                },
            });
            await expect(db.validateStoredData()).resolves.toEqual({
                ok: true,
                checkedRows: 1,
                errorCount: 0,
                truncated: false,
                issues: [],
            });
        } finally {
            await db.close();
        }
    });

    test('reports model, field and id without returning stored values', async () => {
        const db = await createDatabase();
        try {
            await db.knex('validated_record').insert({
                id: 'invalid-row',
                revision: 0,
                title: 'invalid',
                score: 'not-a-number',
                occurred_at: 'not-a-date',
                payload: '{broken-json',
            });
            const report = await db.validateStoredData();
            expect(report.ok).toBe(false);
            expect(report.checkedRows).toBe(1);
            expect(report.issues).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        modelCode: 'validatedRecord',
                        fieldCode: 'revision',
                        recordId: 'invalid-row',
                    }),
                    expect.objectContaining({
                        modelCode: 'validatedRecord',
                        fieldCode: 'payload',
                        recordId: 'invalid-row',
                        reason: 'invalid stored JSON',
                    }),
                ]),
            );
            expect(JSON.stringify(report)).not.toContain('not-a-number');
            expect(JSON.stringify(report)).not.toContain('{broken-json');
        } finally {
            await db.close();
        }
    });

    test('supports error limits and model validation', async () => {
        const db = await createDatabase();
        try {
            await db.knex('validated_record').insert({
                id: 'invalid-row',
                revision: 0,
                title: 'invalid',
                score: 'not-a-number',
                occurred_at: 'not-a-date',
                payload: '{broken-json',
            });
            await expect(
                db.validateStoredData({ stopAfterErrors: 2, batchSize: 1 }),
            ).resolves.toMatchObject({ ok: false, errorCount: 2, truncated: true });
            await expect(
                db.validateStoredData({ models: ['missing'] }),
            ).rejects.toMatchObject({ code: 'LLI400' });
        } finally {
            await db.close();
        }
    });

    test('can stop a model migration before its transaction commits', async () => {
        const db = await createDatabase();
        try {
            await db.knex('validated_record').insert({
                id: 'invalid-row',
                revision: 0,
                title: 'invalid',
                score: 'not-a-number',
                occurred_at: 'not-a-date',
                payload: '{broken-json',
            });
            await expect(
                new ModelTableMigrator(db).syncAll({ validateStoredData: true }),
            ).rejects.toMatchObject({ code: 'LLI40020' });
            await expect(
                new ModelTableMigrator(db).getMigrationStatus(),
            ).resolves.toMatchObject({ status: 'failed' });
        } finally {
            await db.close();
        }
    });
});
