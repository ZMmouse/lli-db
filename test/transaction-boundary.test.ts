import { Database } from '../libs';
import { SysFieldTypeEnum } from '../libs/database/enum/field-type-enum';
import type { IModel } from '../libs/database/types/model';

type QueryEvent = {
    method?: string;
    sql: string;
    __knexTxId?: string;
};

const models: IModel[] = [
    {
        code: 'txParent',
        name: '事务父模型',
        tableName: 'tx_parent',
        attributes: {
            name: {
                code: 'name',
                name: '名称',
                columnName: 'name',
                type: SysFieldTypeEnum.TEXT,
            },
        },
    },
    {
        code: 'txChild',
        name: '事务子模型',
        tableName: 'tx_child',
        parentCode: 'txParent',
        parentRefFieldCode: 'parentId',
        attributes: {
            parentId: {
                code: 'parentId',
                name: '父记录',
                columnName: 'parent_id',
                type: SysFieldTypeEnum.TEXT,
            },
            name: {
                code: 'name',
                name: '名称',
                columnName: 'name',
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
        },
        models,
        encrypt: {
            key: '12345678901234567890123456789012',
            iv: '1234567890123456',
        },
    });

    await db.knex.schema.createTable('tx_parent', (table) => {
        table.string('id').primary();
        table.string('name');
    });
    await db.knex.schema.createTable('tx_child', (table) => {
        table.string('id').primary();
        table.string('parent_id');
        table.string('name');
    });

    return db;
};

const countParents = async (db: Database) => {
    const result = await db.knex('tx_parent').count<{ count: number }>({ count: '*' }).first();
    return Number(result?.count ?? 0);
};

const captureParentQueries = async (db: Database, operation: () => Promise<unknown>) => {
    const queries: QueryEvent[] = [];
    const listener = (query: QueryEvent) => {
        if (query.sql.includes('tx_parent') && query.method) {
            queries.push(query);
        }
    };

    db.knex.on('query', listener);
    try {
        await operation();
    } finally {
        db.knex.off('query', listener);
    }

    return queries;
};

describe('EntityManager transaction boundaries', () => {
    test('批量创建父记录会在同一事务中写入子记录', async () => {
        const db = await createDatabase();

        try {
            const parents = await db.query('txParent').createMany({
                data: [
                    { name: 'parent-1', txChildList: [{ name: 'child-1' }] },
                    { name: 'parent-2', txChildList: [{ name: 'child-2' }] },
                ],
            });
            const parentIdsByName = new Map(
                parents.map((parent) => [parent.name, parent.id] as const),
            );
            const children = await db.knex('tx_child').orderBy('name');

            expect(children).toEqual([
                expect.objectContaining({
                    name: 'child-1',
                    parent_id: parentIdsByName.get('parent-1'),
                }),
                expect.objectContaining({
                    name: 'child-2',
                    parent_id: parentIdsByName.get('parent-2'),
                }),
            ]);
        } finally {
            await db.knex.destroy();
        }
    });

    test('创建子记录失败时回滚主记录', async () => {
        const db = await createDatabase();
        db.middlewareManager.registerGlobalMiddleware('createChild', async () => {
            throw new Error('forced child failure');
        });

        try {
            await expect(
                db.query('txParent').create({
                    data: {
                        name: 'create-parent',
                        txChildList: [{ name: 'child' }],
                    },
                }),
            ).rejects.toThrow('forced child failure');

            expect(await countParents(db)).toBe(0);
        } finally {
            await db.knex.destroy();
        }
    });

    test('批量创建子记录失败时回滚全部主记录', async () => {
        const db = await createDatabase();
        db.middlewareManager.registerGlobalMiddleware('createChildMany', async () => {
            throw new Error('forced child-many failure');
        });

        try {
            await expect(
                db.query('txParent').createMany({
                    data: [
                        { name: 'parent-1', txChildList: [{ name: 'child-1' }] },
                        { name: 'parent-2', txChildList: [{ name: 'child-2' }] },
                    ],
                }),
            ).rejects.toThrow('forced child-many failure');

            expect(await countParents(db)).toBe(0);
        } finally {
            await db.knex.destroy();
        }
    });

    test.each([
        ['delete', (db: Database) => db.query('txParent').delete({ where: { id: 'parent-1' } })],
        [
            'deleteMany',
            (db: Database) =>
                db.query('txParent').deleteMany({
                    where: { name: { startsWith: 'delete-' } },
                }),
        ],
    ])('%s rolls back the main record when child cleanup fails', async (_name, operation) => {
        const db = await createDatabase();
        await db.knex('tx_parent').insert([
            { id: 'parent-1', name: 'delete-1' },
            { id: 'parent-2', name: 'delete-2' },
        ]);
        db.middlewareManager.registerGlobalMiddleware('deleteChildMany', async () => {
            throw new Error('forced delete-child failure');
        });

        try {
            await expect(operation(db)).rejects.toThrow('forced delete-child failure');

            expect(await countParents(db)).toBe(2);
        } finally {
            await db.knex.destroy();
        }
    });

    test.each([
        [
            'update',
            (db: Database) =>
                db.query('txParent').update({
                    where: { id: 'parent-1' },
                    data: { name: 'updated' },
                }),
        ],
        [
            'updateMany',
            (db: Database) =>
                db.query('txParent').updateMany({
                    where: { id: 'parent-1' },
                    data: { name: 'updated' },
                }),
        ],
        [
            'delete',
            (db: Database) => db.query('txParent').delete({ where: { id: 'parent-1' } }),
        ],
        [
            'deleteMany',
            (db: Database) => db.query('txParent').deleteMany({ where: { id: 'parent-1' } }),
        ],
    ])('%s selects and writes through the same transaction', async (_name, operation) => {
        const db = await createDatabase();
        await db.knex('tx_parent').insert({ id: 'parent-1', name: 'before' });

        try {
            const queries = await captureParentQueries(db, () => operation(db));
            expect(queries.length).toBeGreaterThanOrEqual(2);
            expect(queries.every((query) => query.__knexTxId)).toBe(true);
            expect(new Set(queries.map((query) => query.__knexTxId)).size).toBe(1);
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('Database transaction callbacks', () => {
    test('waits for an asynchronous commit callback', async () => {
        const db = await createDatabase();
        let releaseCallback!: () => void;
        let markCallbackStarted!: () => void;
        const callbackGate = new Promise<void>((resolve) => {
            releaseCallback = resolve;
        });
        const callbackStarted = new Promise<void>((resolve) => {
            markCallbackStarted = resolve;
        });

        try {
            let settled = false;
            const transaction = db.transaction(async ({ trx, onCommit }) => {
                await trx('tx_parent').insert({ id: 'parent-1', name: 'created' });
                onCommit(async () => {
                    markCallbackStarted();
                    await callbackGate;
                });
            });
            transaction.then(() => {
                settled = true;
            });

            await callbackStarted;
            await Promise.resolve();
            expect(settled).toBe(false);

            releaseCallback();
            await transaction;
            expect(settled).toBe(true);
        } finally {
            await db.knex.destroy();
        }
    });

    test('commit callback failure rejects after preserving committed data', async () => {
        const db = await createDatabase();
        const callbackError = new Error('commit callback failed');
        let followingCallbackRan = false;

        try {
            await expect(
                db.transaction(async ({ trx, onCommit }) => {
                    await trx('tx_parent').insert({ id: 'parent-1', name: 'created' });
                    onCommit(async () => {
                        throw callbackError;
                    });
                    onCommit(async () => {
                        followingCallbackRan = true;
                    });
                }),
            ).rejects.toBe(callbackError);
            expect(followingCallbackRan).toBe(true);
            expect(await countParents(db)).toBe(1);
        } finally {
            await db.knex.destroy();
        }
    });

    test('waits for an asynchronous rollback callback and preserves the body error', async () => {
        const db = await createDatabase();
        const bodyError = new Error('transaction body failed');
        let releaseCallback!: () => void;
        let markCallbackStarted!: () => void;
        const callbackGate = new Promise<void>((resolve) => {
            releaseCallback = resolve;
        });
        const callbackStarted = new Promise<void>((resolve) => {
            markCallbackStarted = resolve;
        });

        try {
            let settled = false;
            const transaction = db.transaction(async ({ trx, onRollback }) => {
                await trx('tx_parent').insert({ id: 'parent-1', name: 'created' });
                onRollback(async () => {
                    markCallbackStarted();
                    await callbackGate;
                });
                throw bodyError;
            });
            const observed = transaction.then(
                () => undefined,
                (error) => {
                    settled = true;
                    return error;
                },
            );

            await callbackStarted;
            await Promise.resolve();
            expect(settled).toBe(false);

            releaseCallback();
            await expect(observed).resolves.toBe(bodyError);
            expect(await countParents(db)).toBe(0);
        } finally {
            await db.knex.destroy();
        }
    });

    test('rollback callback failure is reported with the body error as its cause', async () => {
        const db = await createDatabase();
        const bodyError = new Error('transaction body failed');
        const callbackError = new Error('rollback callback failed');

        try {
            const error = await db
                .transaction(async ({ trx, onRollback }) => {
                    await trx('tx_parent').insert({ id: 'parent-1', name: 'created' });
                    onRollback(async () => {
                        throw callbackError;
                    });
                    throw bodyError;
                })
                .catch((caught) => caught);

            expect(error).toBe(callbackError);
            expect(error.cause).toBe(bodyError);
            expect(await countParents(db)).toBe(0);
        } finally {
            await db.knex.destroy();
        }
    });
});
