import { Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

const model: IModel = {
    code: 'strictRecord',
    name: 'strict record',
    tableName: 'strict_record',
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
        enabled: {
            code: 'enabled',
            name: 'enabled',
            columnName: 'enabled',
            type: SysFieldTypeEnum.SWITCH,
        },
        occurredAt: {
            code: 'occurredAt',
            name: 'occurred at',
            columnName: 'occurred_at',
            type: SysFieldTypeEnum.DATETIME,
        },
        occurredOn: {
            code: 'occurredOn',
            name: 'occurred on',
            columnName: 'occurred_on',
            type: SysFieldTypeEnum.DATE,
        },
        payload: {
            code: 'payload',
            name: 'payload',
            columnName: 'payload',
            type: SysFieldTypeEnum.JSON,
        },
        internalNote: {
            code: 'internalNote',
            name: 'internal note',
            columnName: 'internal_note',
            type: SysFieldTypeEnum.TEXT,
            readonly: true,
        },
    },
};

const createDatabase = async (mode: 'coerce' | 'strict' = 'strict') => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models: [model],
        validation: {
            mode,
            datetimeFormat: mode === 'strict' ? 'iso-utc-ms' : 'legacy',
        },
    });
    await new ModelTableMigrator(db).syncAll();
    return db;
};

describe('strict write validation', () => {
    test('accepts strict JSON values and returns ISO UTC datetimes', async () => {
        const db = await createDatabase();
        try {
            const row = await db.query<Record<string, unknown>>('strictRecord').create({
                data: {
                    title: 'valid',
                    score: 1.5,
                    enabled: false,
                    occurredAt: '2026-09-11T02:30:15.123Z',
                    occurredOn: '2026-09-11',
                    payload: { nested: [1, true, null] },
                },
            });
            expect(row).toMatchObject({
                title: 'valid',
                score: 1.5,
                enabled: false,
                occurredAt: '2026-09-11T02:30:15.123Z',
                occurredOn: '2026-09-11',
                payload: { nested: [1, true, null] },
            });
        } finally {
            await db.close();
        }
    });

    test.each([
        ['coerced number', { title: 'bad', score: '1.5' }],
        ['coerced boolean', { title: 'bad', enabled: 'false' }],
        ['non-finite number', { title: 'bad', score: Number.POSITIVE_INFINITY }],
        ['unknown field', { title: 'bad', unknown: true }],
        ['caller id', { id: 'caller-id', title: 'bad' }],
        ['readonly field', { title: 'bad', internalNote: 'protected-value' }],
        ['invalid datetime', { title: 'bad', occurredAt: '2026-09-11 02:30:15' }],
        ['impossible datetime', { title: 'bad', occurredAt: '2026-02-31T02:30:15.123Z' }],
        ['impossible date', { title: 'bad', occurredOn: '2026-02-31' }],
        ['undefined JSON member', { title: 'bad', payload: { missing: undefined } }],
    ])('rejects %s', async (_label, data) => {
        const db = await createDatabase();
        try {
            await expect(db.query('strictRecord').create({ data })).rejects.toMatchObject({
                code: 'LLI40020',
            });
        } finally {
            await db.close();
        }
    });

    test('rejects missing and null required fields', async () => {
        const db = await createDatabase();
        try {
            await expect(
                db.query('strictRecord').create({ data: { score: 1 } }),
            ).rejects.toMatchObject({ code: 'LLI40020' });
            await expect(
                db.query('strictRecord').create({ data: { title: null } }),
            ).rejects.toMatchObject({ code: 'LLI40020' });
        } finally {
            await db.close();
        }
    });

    test('keeps historical coercion available by default', async () => {
        const db = await createDatabase('coerce');
        try {
            const row = await db.query<Record<string, unknown>>('strictRecord').create({
                data: { title: 123, score: '1.5', enabled: 'false' },
            });
            expect(row).toMatchObject({ title: '123', score: 1.5, enabled: false });
        } finally {
            await db.close();
        }
    });
});

describe('database close', () => {
    test('is idempotent and rejects new high-level operations', async () => {
        const db = await createDatabase();
        await expect(db.close()).resolves.toBeUndefined();
        await expect(db.close()).resolves.toBeUndefined();
        expect(() => db.query('strictRecord')).toThrow(
            expect.objectContaining({ code: 'LLI41000' }),
        );
    });
});
