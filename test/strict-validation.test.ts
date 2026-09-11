import { Database, ModelTableMigrator, SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

const model: IModel = {
    code: 'strictRecord',
    name: 'strict record',
    tableName: 'strict_record',
    attributes: {
        externalId: {
            code: 'externalId',
            name: 'external id',
            columnName: 'external_id',
            type: SysExpansionFieldTypeEnum.UID,
            required: true,
        },
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
            expect(row.externalId).toEqual(expect.any(String));
        } finally {
            await db.close();
        }
    });

    test('keeps the ISO datetime contract stable across process timezones', async () => {
        const originalTimezone = process.env.TZ;
        try {
            for (const timezone of ['UTC', 'Asia/Shanghai', 'America/Los_Angeles']) {
                process.env.TZ = timezone;
                const db = await createDatabase();
                try {
                    const row = await db.query<{ occurredAt: string }>('strictRecord').create({
                        data: {
                            title: timezone,
                            occurredAt: '2026-09-11T02:30:15.123Z',
                        },
                    });
                    expect(row.occurredAt).toBe('2026-09-11T02:30:15.123Z');
                } finally {
                    await db.close();
                }
            }
        } finally {
            process.env.TZ = originalTimezone;
        }
    });

    test.each([
        ['coerced number', { title: 'bad', score: '1.5' }],
        ['coerced boolean', { title: 'bad', enabled: 'false' }],
        ['non-finite number', { title: 'bad', score: Number.POSITIVE_INFINITY }],
        ['unknown field', { title: 'bad', unknown: true }],
        ['caller id', { id: 'caller-id', title: 'bad' }],
        ['caller UID', { title: 'bad', externalId: 'caller-uid' }],
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

    test('rejects every non-JSON value including circular references', async () => {
        const db = await createDatabase();
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        try {
            for (const payload of [undefined, () => undefined, Symbol('value'), circular]) {
                await expect(
                    db.query('strictRecord').create({ data: { title: 'bad', payload } }),
                ).rejects.toMatchObject({ code: 'LLI40020' });
            }
        } finally {
            await db.close();
        }
    });

    test.each([
        ['fixed default', SysFieldTypeEnum.INT, 'not-an-integer'],
        ['function default', SysFieldTypeEnum.SWITCH, () => 'not-a-boolean'],
    ])('rejects an invalid %s before inserting the row', async (_label, type, defaultValue) => {
        const defaultModel: IModel = {
            code: 'strictDefault',
            name: 'strict default',
            tableName: 'strict_default',
            attributes: {
                value: {
                    code: 'value',
                    name: 'value',
                    columnName: 'value',
                    type,
                    required: true,
                    default: defaultValue as never,
                },
            },
        };
        const db = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
                pool: { min: 1, max: 1 },
            },
            models: [defaultModel],
            validation: { mode: 'strict' },
        });
        try {
            await new ModelTableMigrator(db).syncAll();
            await expect(db.query('strictDefault').create({ data: {} })).rejects.toMatchObject({
                code: 'LLI40020',
            });
            await expect(db.knex('strict_default').count<{ count: number }[]>({ count: '*' })).resolves.toEqual([
                { count: 0 },
            ]);
        } finally {
            await db.close();
        }
    });

    test('validates and converts a valid default through the normal field pipeline', async () => {
        const defaultModel: IModel = {
            code: 'strictJsonDefault',
            name: 'strict JSON default',
            tableName: 'strict_json_default',
            attributes: {
                payload: {
                    code: 'payload',
                    name: 'payload',
                    columnName: 'payload',
                    type: SysFieldTypeEnum.JSON,
                    required: true,
                    default: () => ({ enabled: true }),
                },
            },
        };
        const db = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
                pool: { min: 1, max: 1 },
            },
            models: [defaultModel],
            validation: { mode: 'strict' },
        });
        try {
            await new ModelTableMigrator(db).syncAll();
            await expect(db.query('strictJsonDefault').create({ data: {} })).resolves.toMatchObject({
                payload: { enabled: true },
            });
            await expect(db.knex('strict_json_default').select('payload').first()).resolves.toMatchObject({
                payload: JSON.stringify({ enabled: true }),
            });
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

describe('strict nested records', () => {
    const nestedModels: IModel[] = [
        {
            code: 'strictParent',
            name: 'strict parent',
            tableName: 'strict_parent',
            childCodes: ['strictChild'],
            attributes: {},
        },
        {
            code: 'strictChild',
            name: 'strict child',
            tableName: 'strict_child',
            parentCode: 'strictParent',
            parentRefFieldCode: 'parentId',
            attributes: {
                parentId: {
                    code: 'parentId',
                    name: 'parent id',
                    columnName: 'parent_id',
                    type: SysFieldTypeEnum.TEXT,
                    required: true,
                },
                rank: {
                    code: 'rank',
                    name: 'rank',
                    columnName: 'rank_value',
                    type: SysFieldTypeEnum.INT,
                    required: true,
                },
            },
        },
    ];

    test('recursively validates child payloads before writing', async () => {
        const db = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            },
            models: nestedModels,
            validation: { mode: 'strict' },
        });
        await new ModelTableMigrator(db).syncAll();
        try {
            await expect(
                db.query('strictParent').create({
                    data: { strictChildList: [{ rank: '1' }] },
                }),
            ).rejects.toMatchObject({ code: 'LLI40020' });
            await expect(db.query('strictParent').count({})).resolves.toBe(0);

            const parent = await db.query<{ id: string }>('strictParent').create({
                data: { strictChildList: [{ rank: 1 }] },
            });
            await expect(
                db.query('strictChild').findMany({ where: { parentId: parent.id } }),
            ).resolves.toHaveLength(1);
        } finally {
            await db.close();
        }
    });

    test('child write failure rolls back the parent revision and data', async () => {
        const models: IModel[] = [
            {
                code: 'revisionParent',
                name: 'revision parent',
                tableName: 'revision_parent',
                useRevision: true,
                childCodes: ['uniqueChild'],
                attributes: {
                    title: {
                        code: 'title',
                        name: 'title',
                        columnName: 'title',
                        type: SysFieldTypeEnum.TEXT,
                        required: true,
                    },
                },
            },
            {
                code: 'uniqueChild',
                name: 'unique child',
                tableName: 'unique_child',
                parentCode: 'revisionParent',
                parentRefFieldCode: 'parentId',
                attributes: {
                    parentId: {
                        code: 'parentId',
                        name: 'parent id',
                        columnName: 'parent_id',
                        type: SysFieldTypeEnum.TEXT,
                        required: true,
                    },
                    rank: {
                        code: 'rank',
                        name: 'rank',
                        columnName: 'rank_value',
                        type: SysFieldTypeEnum.INT,
                        required: true,
                        unique: true,
                    },
                },
            },
        ];
        const db = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            },
            models,
            validation: { mode: 'strict' },
        });
        await new ModelTableMigrator(db).syncAll();
        try {
            const parent = await db.query<{ id: string }>('revisionParent').create({
                data: { title: 'before', uniqueChildList: [{ rank: 1 }] },
            });
            await expect(
                db.query('revisionParent').update({
                    where: { id: parent.id },
                    expectedRevision: 1,
                    data: { title: 'after', uniqueChildList: [{ rank: 1 }] },
                }),
            ).rejects.toBeDefined();
            await expect(
                db.knex('revision_parent').where({ id: parent.id }).first(),
            ).resolves.toMatchObject({ title: 'before', revision: 1 });
            await expect(db.knex('unique_child')).resolves.toHaveLength(1);
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
