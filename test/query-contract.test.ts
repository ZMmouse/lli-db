import { Database, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';
import { ModelTableMigrator } from '../libs/migrator';
import { cloneDeep } from 'lodash';

const models: IModel[] = [
    {
        code: 'contractAuthor',
        name: 'author',
        tableName: 'contract_author',
        attributes: {
            displayName: {
                code: 'displayName',
                name: 'display name',
                columnName: 'display_name',
                type: SysFieldTypeEnum.TEXT,
            },
        },
    },
    {
        code: 'contractPost',
        name: 'post',
        tableName: 'contract_post',
        attributes: {
            title: {
                code: 'title',
                name: 'title',
                columnName: 'title',
                type: SysFieldTypeEnum.TEXT,
            },
            author: {
                code: 'author',
                name: 'author',
                columnName: 'author_id',
                type: SysFieldTypeEnum.SINGLE_QUOTE,
                refCode: 'contractAuthor',
                refFieldCode: 'id',
                refDisplayCode: 'displayName',
            },
        },
    },
    {
        code: 'contractTimestamp',
        name: 'timestamped record',
        tableName: 'contract_timestamp',
        useCreatedFields: true,
        useUpdatedFields: true,
        attributes: {
            name: {
                code: 'name',
                name: 'name',
                columnName: 'name',
                type: SysFieldTypeEnum.TEXT,
            },
        },
    },
    {
        code: 'contractGuard',
        name: 'guarded record',
        tableName: 'contract_guard',
        useLogicDelete: true,
        attributes: {
            displayName: {
                code: 'displayName',
                name: 'display name',
                columnName: 'display_name',
                type: SysFieldTypeEnum.TEXT,
            },
        },
    },
];

const createDatabase = async () => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        modelConfig: {
            userModelCode: 'contractAuthor',
            userModelDisplayCode: 'displayName',
        },
        models,
    });
    await new ModelTableMigrator(db).syncAll();
    await db.knex('contract_author').insert([
        { id: 'author-1', display_name: 'Alice' },
        { id: 'author-2', display_name: 'Bob' },
    ]);
    await db.knex('contract_post').insert([
        { id: 'post-1', title: 'Alice post', author_id: 'author-1' },
        { id: 'post-2', title: 'Bob post', author_id: 'author-2' },
    ]);
    await db.knex('contract_guard').insert([
        { id: 'guard-1', display_name: 'first', deleted: false },
        { id: 'guard-2', display_name: 'second', deleted: false },
    ]);
    return db;
};

describe('where and filters contract', () => {
    test('findOne returns null when no row matches', async () => {
        const db = await createDatabase();

        try {
            await expect(
                db.query('contractAuthor').findOne({ where: { id: 'missing-author' } }),
            ).resolves.toBeNull();
        } finally {
            await db.knex.destroy();
        }
    });

    test('filters remains a deprecated alias for where', async () => {
        const db = await createDatabase();

        try {
            const rows = await db.query('contractAuthor').findMany({
                filters: { displayName: { startsWith: 'Ali' } },
            });
            expect(rows).toEqual([
                expect.objectContaining({ id: 'author-1', displayName: 'Alice' }),
            ]);
        } finally {
            await db.knex.destroy();
        }
    });

    test('where and filters are combined with AND', async () => {
        const db = await createDatabase();

        try {
            await expect(
                db.query('contractAuthor').findMany({
                    where: { id: 'author-2' },
                    filters: { displayName: 'Alice' },
                }),
            ).resolves.toEqual([]);
        } finally {
            await db.knex.destroy();
        }
    });

    test('write operations normalize filters before selecting rows', async () => {
        const db = await createDatabase();

        try {
            const result = await db.query('contractAuthor').updateMany({
                filters: { displayName: 'Bob' },
                data: { displayName: 'Robert' },
            });
            expect(result.count).toBe(1);
            await expect(
                db.query('contractAuthor').findMany({ orderBy: { id: 'asc' } }),
            ).resolves.toEqual([
                expect.objectContaining({ id: 'author-1', displayName: 'Alice' }),
                expect.objectContaining({ id: 'author-2', displayName: 'Robert' }),
            ]);
        } finally {
            await db.knex.destroy();
        }
    });

    test('populate filters are normalized and combined with relation constraints', async () => {
        const db = await createDatabase();

        try {
            const rows = await db.query('contractPost').findMany({
                orderBy: { id: 'asc' },
                populate: {
                    author: {
                        select: ['id', 'displayName'],
                        filters: { displayName: 'Alice' },
                    },
                },
            });
            expect(rows[0].author).toMatchObject({ id: 'author-1', displayName: 'Alice' });
            expect(rows[1].author).toBeNull();
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('updateMany safety contract', () => {
    test.each([
        ['missing where', {}],
        ['empty where', { where: {} }],
        ['empty filters', { filters: {} }],
        ['empty logical condition', { where: { and: [] } }],
    ])('rejects %s without changing rows', async (_label, condition) => {
        const db = await createDatabase();

        try {
            await expect(
                db.query('contractGuard').updateMany({
                    ...condition,
                    data: { displayName: 'overwritten' },
                }),
            ).rejects.toMatchObject({
                code: 'LLI400',
                message: expect.stringContaining('allowAll'),
            });
            await expect(
                db.query('contractGuard').findMany({ orderBy: { id: 'asc' } }),
            ).resolves.toEqual([
                expect.objectContaining({ id: 'guard-1', displayName: 'first' }),
                expect.objectContaining({ id: 'guard-2', displayName: 'second' }),
            ]);
        } finally {
            await db.knex.destroy();
        }
    });

    test('allowAll explicitly updates every row', async () => {
        const db = await createDatabase();

        try {
            await expect(
                db.query('contractGuard').updateMany({
                    allowAll: true,
                    data: { displayName: 'updated-all' },
                }),
            ).resolves.toMatchObject({ count: 2 });
            await expect(db.query('contractGuard').findMany()).resolves.toEqual([
                expect.objectContaining({ displayName: 'updated-all' }),
                expect.objectContaining({ displayName: 'updated-all' }),
            ]);
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('returning contract', () => {
    test('maps a model field code to its custom column name', async () => {
        const db = await createDatabase();

        try {
            const rows = await db
                .createQueryBuilder('contractAuthor')
                .insert({ id: 'author-3', displayName: 'Carol' })
                .returning('displayName')
                .execute<Array<{ display_name: string }>>();

            expect(rows).toEqual([{ display_name: 'Carol' }]);
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('custom column name query contract', () => {
    test('select, where and orderBy consistently use the model field code', async () => {
        const db = await createDatabase();

        try {
            const rows = await db.query<{ displayName: string }>('contractAuthor').findMany({
                select: ['displayName'],
                where: { displayName: { in: ['Alice', 'Bob'] } },
                orderBy: { displayName: 'desc' },
            });

            expect(rows).toEqual([{ displayName: 'Bob' }, { displayName: 'Alice' }]);
            expect(rows[0]).not.toHaveProperty('display_name');
        } finally {
            await db.knex.destroy();
        }
    });

    test('relation orderBy recurses into the referenced model and maps its custom column', async () => {
        const db = await createDatabase();

        try {
            const rows = await db.query<{ title: string }>('contractPost').findMany({
                select: ['title'],
                orderBy: { author: { displayName: 'desc' } },
            });

            expect(rows).toEqual([{ title: 'Bob post' }, { title: 'Alice post' }]);
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('query input immutability', () => {
    test('direct insert does not rewrite field codes in caller data', async () => {
        const db = await createDatabase();
        const data = { id: 'author-3', displayName: 'Carol' };
        const snapshot = cloneDeep(data);

        try {
            await db.createQueryBuilder('contractAuthor').insert(data).execute();
            expect(data).toEqual(snapshot);
        } finally {
            await db.knex.destroy();
        }
    });

    test('direct update does not rewrite field codes in caller data', async () => {
        const db = await createDatabase();
        const data = { displayName: 'Alicia' };
        const snapshot = cloneDeep(data);

        try {
            await db
                .createQueryBuilder('contractAuthor')
                .where({ id: 'author-1' })
                .update(data)
                .execute();
            expect(data).toEqual(snapshot);
        } finally {
            await db.knex.destroy();
        }
    });

    test('repository middleware does not add generated fields to caller data', async () => {
        const db = await createDatabase();
        const params = { data: { displayName: 'Carol' } };
        const snapshot = cloneDeep(params);

        try {
            await db.query('contractAuthor').create(params);
            expect(params).toEqual(snapshot);
        } finally {
            await db.knex.destroy();
        }
    });

    test('populate does not add required fields to caller select arrays', async () => {
        const db = await createDatabase();
        const params = {
            select: ['id', 'title'],
            populate: {
                author: {
                    select: ['displayName'],
                    where: { displayName: { startsWith: 'A' } },
                },
            },
        };
        const snapshot = cloneDeep(params);

        try {
            await db.query('contractPost').findMany(params);
            expect(params).toEqual(snapshot);
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('update timestamps', () => {
    const historicalDate = new Date('2000-01-01T00:00:00.000Z');
    const callerDate = new Date('2099-01-01T00:00:00.000Z');

    test('update refreshes updatedAt without changing createdAt or caller data', async () => {
        const db = await createDatabase();
        await db.query('contractTimestamp').create({
            data: {
                name: 'before',
                createdAt: historicalDate,
                updatedAt: historicalDate,
            },
        });
        const params = {
            where: { name: 'before' },
            data: { name: 'after', updatedAt: callerDate },
        };
        const snapshot = cloneDeep(params);

        try {
            await db.query('contractTimestamp').update(params);
            const row = await db.knex('contract_timestamp').where({ name: 'after' }).first();

            expect(new Date(row.created_at).getTime()).toBe(historicalDate.getTime());
            expect(new Date(row.updated_at).getTime()).toBeGreaterThan(historicalDate.getTime());
            expect(new Date(row.updated_at).getTime()).toBeLessThan(callerDate.getTime());
            expect(params).toEqual(snapshot);
        } finally {
            await db.knex.destroy();
        }
    });

    test('updateMany applies one automatic updatedAt value to every matched row', async () => {
        const db = await createDatabase();
        await db.query('contractTimestamp').createMany({
            data: [
                {
                    name: 'before-1',
                    createdAt: historicalDate,
                    updatedAt: historicalDate,
                },
                {
                    name: 'before-2',
                    createdAt: historicalDate,
                    updatedAt: historicalDate,
                },
            ],
        });
        const data = { name: 'after', updatedAt: callerDate };
        const snapshot = cloneDeep(data);

        try {
            const result = await db.query('contractTimestamp').updateMany({
                where: { name: { startsWith: 'before-' } },
                data,
            });
            const rows = await db.knex('contract_timestamp').orderBy('id');

            expect(result.count).toBe(2);
            expect(rows[0].updated_at).toEqual(rows[1].updated_at);
            expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThan(
                historicalDate.getTime(),
            );
            expect(new Date(rows[0].updated_at).getTime()).toBeLessThan(callerDate.getTime());
            expect(data).toEqual(snapshot);
        } finally {
            await db.knex.destroy();
        }
    });
});
