import { db } from './test-database';

test('使用隔离的 SQLite 数据库同步模型', async () => {
    expect(db.knex.client.config.client).toBe('better-sqlite3');

    const records = await db.query('lliModelRecord').findMany({
        where: {
            code: 'lliModelRecord',
        },
    });
    const hasModelRecordTable = await db.knex.schema.hasTable('lli_model_record');

    expect(records).toHaveLength(1);
    expect(hasModelRecordTable).toBe(true);
});
