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

const createDatabase = async (models: IModel[]) => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models,
    });
    await new ModelTableMigrator(db).syncAll();
    return db;
};

describe('relation writes', () => {
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
