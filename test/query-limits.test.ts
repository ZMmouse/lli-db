import { Database, SysFieldTypeEnum } from '../libs';
import type { IModel, IParams } from '../libs';
import { ModelTableMigrator } from '../libs/migrator';

const textAttribute = (code: string, columnName = code) => ({
    code,
    name: code,
    columnName,
    type: SysFieldTypeEnum.TEXT,
});

const models: IModel[] = [
    {
        code: 'limitAuthor',
        name: 'author',
        tableName: 'limit_author',
        attributes: { name: textAttribute('name') },
    },
    {
        code: 'limitPost',
        name: 'post',
        tableName: 'limit_post',
        attributes: {
            title: textAttribute('title'),
            author: {
                ...textAttribute('author', 'author_id'),
                type: SysFieldTypeEnum.SINGLE_QUOTE,
                refCode: 'limitAuthor',
                refFieldCode: 'id',
                refDisplayCode: 'name',
            },
            tags: {
                ...textAttribute('tags'),
                type: SysFieldTypeEnum.MULTI_QUOTE,
                refCode: 'limitTag',
                refFieldCode: 'id',
                refDisplayCode: 'name',
                midCode: 'limitPostTag',
                selfInMidFieldCode: 'postId',
                refInMidFieldCode: 'tagId',
            },
        },
    },
    {
        code: 'limitTag',
        name: 'tag',
        tableName: 'limit_tag',
        attributes: { name: textAttribute('name') },
    },
    {
        code: 'limitPostTag',
        name: 'post tag',
        tableName: 'limit_post_tag',
        attributes: {
            postId: textAttribute('postId', 'post_id'),
            tagId: textAttribute('tagId', 'tag_id'),
        },
    },
    {
        code: 'limitComment',
        name: 'comment',
        tableName: 'limit_comment',
        parentCode: 'limitPost',
        parentRefFieldCode: 'postId',
        attributes: {
            postId: textAttribute('postId', 'post_id'),
            body: textAttribute('body'),
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
        models,
        query: {
            maxPageSize: 2,
            maxLimit: 2,
            maxOffset: 4,
            populateBatchSize: 2,
        },
    });
    await new ModelTableMigrator(db).syncAll();

    const sequence = [1, 2, 3, 4, 5];
    await db.knex('limit_author').insert(
        sequence.map((id) => ({ id: `author-${id}`, name: `author ${id}` })),
    );
    await db.knex('limit_post').insert(
        sequence.map((id) => ({ id: `post-${id}`, title: `post ${id}`, author_id: `author-${id}` })),
    );
    await db.knex('limit_tag').insert(
        sequence.map((id) => ({ id: `tag-${id}`, name: `tag ${id}` })),
    );
    await db.knex('limit_post_tag').insert(
        sequence.map((id) => ({ id: `post-tag-${id}`, post_id: `post-${id}`, tag_id: `tag-${id}` })),
    );
    await db.knex('limit_comment').insert(
        sequence.map((id) => ({ id: `comment-${id}`, post_id: `post-${id}`, body: `comment ${id}` })),
    );
    return db;
};

describe('query pagination limits', () => {
    test('rejects invalid query limit configuration before opening a connection', () => {
        expect(
            () =>
                new Database({
                    connection: {
                        client: 'better-sqlite3',
                        connection: { filename: ':memory:' },
                    },
                    models,
                    query: { populateBatchSize: 0 },
                }),
        ).toThrow(expect.objectContaining({ code: 'LLI500' }));
    });

    test.each<[string, IParams]>([
        ['zero page', { page: 0, pageSize: 1 }],
        ['zero pageSize', { page: 1, pageSize: 0 }],
        ['page without pageSize', { page: 1 }],
        ['pageSize without page', { pageSize: 1 }],
        ['pageSize over limit', { page: 1, pageSize: 3 }],
        ['calculated offset over limit', { page: 4, pageSize: 2 }],
        ['zero limit', { limit: 0 }],
        ['fractional limit', { limit: 1.5 }],
        ['limit over maximum', { limit: 3 }],
        ['negative offset', { offset: -1 }],
        ['offset over maximum', { offset: 5 }],
        ['mixed pagination styles', { page: 1, pageSize: 1, limit: 1 }],
    ])('rejects %s', async (_label, params) => {
        const db = await createDatabase();
        try {
            await expect(db.query('limitPost').findMany(params)).rejects.toMatchObject({
                code: 'LLI400',
            });
        } finally {
            await db.knex.destroy();
        }
    });

    test('accepts configured page and limit boundaries', async () => {
        const db = await createDatabase();
        try {
            await expect(
                db.query('limitPost').findMany({
                    page: 2,
                    pageSize: 2,
                    orderBy: { id: 'asc' },
                }),
            ).resolves.toEqual([
                expect.objectContaining({ id: 'post-3' }),
                expect.objectContaining({ id: 'post-4' }),
            ]);
            await expect(
                db.query('limitPost').findMany({ limit: 2, offset: 4, orderBy: { id: 'asc' } }),
            ).resolves.toEqual([expect.objectContaining({ id: 'post-5' })]);
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('populate batching', () => {
    test('batches single, child, and many-to-many relation IDs', async () => {
        const db = await createDatabase();
        const relationQueryCounts = {
            author: 0,
            comment: 0,
            tag: 0,
        };
        const listener = ({ sql }: { sql: string }) => {
            if (sql.includes('limit_author')) relationQueryCounts.author += 1;
            if (sql.includes('limit_comment')) relationQueryCounts.comment += 1;
            if (sql.includes('limit_tag')) relationQueryCounts.tag += 1;
        };
        db.knex.on('query', listener);

        try {
            const posts = await db.query('limitPost').findMany({
                orderBy: { id: 'asc' },
                populate: {
                    author: ['id', 'name'],
                    limitComment: ['id', 'body'],
                    tags: ['id', 'name'],
                },
            });

            expect(relationQueryCounts).toEqual({ author: 3, comment: 3, tag: 3 });
            posts.forEach((post, index) => {
                const number = index + 1;
                expect(post.author).toMatchObject({ id: `author-${number}` });
                expect(post.limitCommentList).toEqual([
                    expect.objectContaining({ id: `comment-${number}` }),
                ]);
                expect(post.tags).toEqual([expect.objectContaining({ id: `tag-${number}` })]);
            });
        } finally {
            db.knex.off('query', listener);
            await db.knex.destroy();
        }
    });
});
