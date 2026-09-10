import { Database, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

const models: IModel[] = [
    {
        code: 'populateUser',
        name: '用户',
        tableName: 'populate_user',
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
        code: 'populatePost',
        name: '文章',
        tableName: 'populate_post',
        attributes: {
            author: {
                code: 'author',
                name: '作者',
                columnName: 'author_id',
                type: SysFieldTypeEnum.SINGLE_QUOTE,
                refCode: 'populateUser',
                refFieldCode: 'id',
                refDisplayCode: 'name',
            },
        },
    },
];

test('init 对同一个 populate 只构建一次', async () => {
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

    try {
        const queryBuilder = db.createQueryBuilder('populatePost');
        const populateSpy = jest.spyOn(queryBuilder, 'populate');

        queryBuilder.init({
            populate: {
                author: { select: ['id', 'name'] },
            },
        });

        expect(populateSpy).toHaveBeenCalledTimes(1);
    } finally {
        await db.knex.destroy();
    }
});
