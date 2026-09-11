import { Database, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';
import { ModelTableMigrator } from '../libs/migrator';

const textAttribute = (code: string, columnName = code, required = false) => ({
    code,
    name: code,
    columnName,
    type: SysFieldTypeEnum.TEXT,
    required,
});

const relationModels = (requireIntermediateMarker = false): IModel[] => [
    {
        code: 'article',
        name: 'article',
        tableName: 'article',
        attributes: {
            title: textAttribute('title'),
            tags: {
                code: 'tags',
                name: 'tags',
                columnName: 'tags',
                type: SysFieldTypeEnum.MULTI_QUOTE,
                refCode: 'tag',
                refFieldCode: 'id',
                refDisplayCode: 'name',
                midCode: 'articleTag',
                selfInMidFieldCode: 'articleId',
                refInMidFieldCode: 'tagId',
            },
        },
    },
    {
        code: 'tag',
        name: 'tag',
        tableName: 'tag',
        attributes: { name: textAttribute('name') },
    },
    {
        code: 'articleTag',
        name: 'article tag',
        tableName: 'article_tag',
        attributes: {
            articleId: textAttribute('articleId', 'article_id'),
            tagId: textAttribute('tagId', 'tag_id'),
            ...(requireIntermediateMarker
                ? { marker: textAttribute('marker', 'marker', true) }
                : {}),
        },
    },
];

const treeModels: IModel[] = [
    {
        code: 'treeNode',
        name: 'tree node',
        tableName: 'tree_node',
        useTree: true,
        attributes: {
            code: textAttribute('code'),
            name: textAttribute('name'),
        },
    },
];

const childDeleteModels: IModel[] = [
    {
        code: 'sysUser',
        name: 'user',
        tableName: 'sys_user',
        attributes: { nickname: textAttribute('nickname') },
    },
    {
        code: 'deleteParent',
        name: 'delete parent',
        tableName: 'delete_parent',
        useRevision: true,
        attributes: { name: textAttribute('name') },
    },
    {
        code: 'deleteChild',
        name: 'delete child',
        tableName: 'delete_child',
        parentCode: 'deleteParent',
        parentRefFieldCode: 'parentId',
        useLogicDelete: true,
        useRevision: true,
        attributes: {
            parentId: textAttribute('parentId', 'parent_id', true),
            name: textAttribute('name'),
        },
    },
    {
        code: 'deleteGrandchild',
        name: 'delete grandchild',
        tableName: 'delete_grandchild',
        parentCode: 'deleteChild',
        parentRefFieldCode: 'childId',
        useLogicDelete: true,
        attributes: {
            childId: textAttribute('childId', 'child_id', true),
            name: textAttribute('name'),
        },
    },
];

const createDatabase = async (models: IModel[], strict = false) => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models,
        validation: strict ? { mode: 'strict' } : undefined,
    });
    await new ModelTableMigrator(db).syncAll();
    return db;
};

describe('relation writes', () => {
    test('strict mode accepts id arrays for multi-quote fields', async () => {
        const db = await createDatabase(relationModels(), true);
        try {
            await expect(
                db.query('article').create({ data: { tags: ['tag-1', 'tag-2'] } }),
            ).resolves.toBeDefined();
            await expect(
                db.query('article').create({ data: { tags: 'tag-1' } }),
            ).rejects.toMatchObject({ code: 'LLI40020' });
        } finally {
            await db.close();
        }
    });

    test('single create with only a multi-quote field writes the intermediate rows', async () => {
        const db = await createDatabase(relationModels());

        try {
            const article = await db.query('article').create({
                data: { tags: ['tag-1', 'tag-2'] },
            });
            const rows = await db.knex('article_tag').orderBy('tag_id');

            expect(rows).toEqual([
                expect.objectContaining({ article_id: article.id, tag_id: 'tag-1' }),
                expect.objectContaining({ article_id: article.id, tag_id: 'tag-2' }),
            ]);
        } finally {
            await db.knex.destroy();
        }
    });

    test('intermediate-row failure rolls back the main record', async () => {
        const db = await createDatabase(relationModels(true));
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            await expect(
                db.query('article').create({
                    data: { title: 'must roll back', tags: ['tag-1'] },
                }),
            ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_NOTNULL' });

            await expect(
                db.knex('article').count<{ count: number }>({ count: '*' }).first(),
            ).resolves.toMatchObject({ count: 0 });
            await expect(
                db.knex('article_tag').count<{ count: number }>({ count: '*' }).first(),
            ).resolves.toMatchObject({ count: 0 });
        } finally {
            errorLog.mockRestore();
            await db.knex.destroy();
        }
    });

    test('relation failure rolls back a revision increment and main-row update', async () => {
        const models = relationModels(true);
        models[0].useRevision = true;
        const db = await createDatabase(models, true);
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const article = await db.query<{ id: string }>('article').create({
                data: { title: 'before' },
            });
            await expect(
                db.query('article').update({
                    where: { id: article.id },
                    expectedRevision: 1,
                    data: { title: 'after', tags: ['tag-1'] },
                }),
            ).rejects.toMatchObject({ code: 'SQLITE_CONSTRAINT_NOTNULL' });
            await expect(
                db.knex('article').where({ id: article.id }).first(),
            ).resolves.toMatchObject({ title: 'before', revision: 1 });
            await expect(db.knex('article_tag')).resolves.toHaveLength(0);
        } finally {
            errorLog.mockRestore();
            await db.close();
        }
    });
});

describe('nested child deletes', () => {
    test('updates only a child owned by the current parent and increments its revision', async () => {
        const db = await createDatabase(childDeleteModels, true);
        try {
            const first = await db.query<{ id: string }>('deleteParent').create({
                data: { name: 'first', deleteChildList: [{ name: 'first child' }] },
            });
            const second = await db.query<{ id: string }>('deleteParent').create({
                data: { name: 'second', deleteChildList: [{ name: 'second child' }] },
            });
            const firstChild = await db.knex('delete_child').where({ parent_id: first.id }).first();
            const secondChild = await db.knex('delete_child').where({ parent_id: second.id }).first();

            await expect(
                db.query('deleteParent').update({
                    where: { id: first.id },
                    expectedRevision: 1,
                    data: {
                        deleteChildList: [
                            { id: firstChild.id, name: 'updated', __op: 'update' },
                        ],
                    },
                }),
            ).resolves.toMatchObject({ revision: 2 });
            await expect(
                db.knex('delete_child').where({ id: firstChild.id }).first(),
            ).resolves.toMatchObject({ parent_id: first.id, name: 'updated', revision: 2 });

            await expect(
                db.query('deleteParent').update({
                    where: { id: first.id },
                    expectedRevision: 2,
                    data: {
                        deleteChildList: [
                            { id: secondChild.id, name: 'stolen', __op: 'update' },
                        ],
                    },
                }),
            ).rejects.toMatchObject({ code: 'LLI40020' });
            await expect(
                db.knex('delete_parent').where({ id: first.id }).first(),
            ).resolves.toMatchObject({ revision: 2 });
            await expect(
                db.knex('delete_child').where({ id: secondChild.id }).first(),
            ).resolves.toMatchObject({ parent_id: second.id, name: 'second child', revision: 1 });
        } finally {
            await db.close();
        }
    });

    test('does not insert a missing child through an update operation', async () => {
        const db = await createDatabase(childDeleteModels, true);
        try {
            const parent = await db.query<{ id: string }>('deleteParent').create({
                data: { name: 'parent' },
            });

            await expect(
                db.query('deleteParent').update({
                    where: { id: parent.id },
                    expectedRevision: 1,
                    data: {
                        deleteChildList: [
                            { id: 'missing-child', name: 'missing', __op: 'update' },
                        ],
                    },
                }),
            ).rejects.toMatchObject({ code: 'LLI40020' });
            await expect(db.knex('delete_child')).resolves.toHaveLength(0);
            await expect(
                db.knex('delete_parent').where({ id: parent.id }).first(),
            ).resolves.toMatchObject({ revision: 1 });
        } finally {
            await db.close();
        }
    });

    test('preserves logical-delete, revision, and descendant semantics', async () => {
        const db = await createDatabase(childDeleteModels, true);
        try {
            const parent = await db.query<{ id: string }>('deleteParent').create({
                data: {
                    name: 'parent',
                    deleteChildList: [
                        {
                            name: 'child',
                            deleteGrandchildList: [{ name: 'grandchild' }],
                        },
                    ],
                },
            });
            const child = await db.knex('delete_child').where({ parent_id: parent.id }).first();
            const grandchild = await db.knex('delete_grandchild').first();

            await expect(
                db.query('deleteParent').update({
                    where: { id: parent.id },
                    expectedRevision: 1,
                    data: { deleteChildList: [{ id: child.id, __op: 'delete' }] },
                }),
            ).resolves.toMatchObject({ revision: 2 });
            await expect(
                db.knex('delete_child').where({ id: child.id }).first(),
            ).resolves.toMatchObject({ deleted: 1, revision: 2 });
            await expect(
                db.knex('delete_grandchild').where({ id: grandchild.id }).first(),
            ).resolves.toMatchObject({ deleted: 1 });
        } finally {
            await db.close();
        }
    });

    test('cannot delete a child through a different parent payload', async () => {
        const db = await createDatabase(childDeleteModels, true);
        try {
            const first = await db.query<{ id: string }>('deleteParent').create({
                data: { name: 'first' },
            });
            const second = await db.query<{ id: string }>('deleteParent').create({
                data: { name: 'second', deleteChildList: [{ name: 'second child' }] },
            });
            const secondChild = await db.knex('delete_child').where({ parent_id: second.id }).first();

            await db.query('deleteParent').update({
                where: { id: first.id },
                expectedRevision: 1,
                data: { deleteChildList: [{ id: secondChild.id, __op: 'delete' }] },
            });

            await expect(
                db.knex('delete_child').where({ id: secondChild.id }).first(),
            ).resolves.toMatchObject({ parent_id: second.id, deleted: 0, revision: 1 });
        } finally {
            await db.close();
        }
    });
});

describe('tree middleware', () => {
    test('create validates ctx.params.data and accepts a complete tree path', async () => {
        const db = await createDatabase(treeModels);

        try {
            await expect(
                db.query('treeNode').create({ data: { code: 'invalid', name: 'invalid' } }),
            ).rejects.toMatchObject({ code: 'LLI400', message: 'parentUri必须要传值' });

            const node = await db.query('treeNode').create({
                data: { code: 'root', name: 'root', parentUri: '/' },
            });
            expect(node).toMatchObject({ code: 'root', parentUri: '/' });
        } finally {
            await db.knex.destroy();
        }
    });

    test('update and updateMany validate moved tree nodes from ctx.params.data', async () => {
        const db = await createDatabase(treeModels);

        try {
            const node = await db.query('treeNode').create({
                data: { code: 'child', name: 'child', parentUri: '/' },
            });

            await expect(
                db.query('treeNode').update({
                    where: { id: node.id },
                    data: { parentId: 'parent-id' },
                }),
            ).rejects.toMatchObject({ code: 'LLI400', message: 'parentUri必须要传值' });

            await expect(
                db.query('treeNode').updateMany({
                    where: { id: node.id },
                    data: { parentId: 'parent-id' },
                }),
            ).rejects.toMatchObject({ code: 'LLI400', message: 'parentUri必须要传值' });

            const updated = await db.query('treeNode').update({
                where: { id: node.id },
                data: {
                    parentId: 'parent-id',
                    parentUri: '/parent-id',
                    code: 'child',
                },
            });
            expect(updated).toMatchObject({ parentId: 'parent-id', parentUri: '/parent-id' });
        } finally {
            await db.knex.destroy();
        }
    });
});
