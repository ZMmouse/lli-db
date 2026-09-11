import { randomUUID } from 'node:crypto';
import { Database, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

const connectionString = process.env.LLI_DB_TEST_PG_URL;
const describePostgres = connectionString ? describe : describe.skip;

describePostgres('PostgreSQL cursor and returning integration', () => {
    const tableName = `lli_db_contract_${randomUUID().replace(/-/g, '')}`;
    const model: IModel = {
        code: 'pgContract',
        name: 'pg contract',
        tableName,
        attributes: {
            rank: {
                code: 'rank',
                name: 'rank',
                columnName: 'rank_value',
                type: SysFieldTypeEnum.INT,
            },
            title: {
                code: 'title',
                name: 'title',
                columnName: 'title_text',
                type: SysFieldTypeEnum.TEXT,
                required: true,
            },
        },
    };
    let db: Database;

    beforeAll(async () => {
        db = new Database({
            connection: { client: 'pg', connection: connectionString },
            models: [model],
            validation: { mode: 'strict' },
        });
        await db.knex.schema.createTable(tableName, (table) => {
            table.string('id').primary();
            table.integer('rank_value').nullable();
            table.string('title_text').notNullable();
        });
        await db.knex(tableName).insert([
            { id: 'a', rank_value: 1, title_text: 'one' },
            { id: 'b', rank_value: 2, title_text: 'two' },
            { id: 'c', rank_value: null, title_text: 'null' },
        ]);
    });

    afterAll(async () => {
        await db.knex.schema.dropTableIfExists(tableName);
        await db.close();
    });

    test('keeps nulls last across cursor pages', async () => {
        const first = await db
            .query<{ id: string; rank: number | null }>('pgContract')
            .findCursorPage({ orderBy: [{ field: 'rank', direction: 'asc' }], limit: 2 });
        const second = await db
            .query<{ id: string; rank: number | null }>('pgContract')
            .findCursorPage({
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
                after: first.nextPosition,
            });
        expect(first.rows.map((row) => row.id)).toEqual(['a', 'b']);
        expect(second.rows.map((row) => row.id)).toEqual(['c']);
    });

    test('returns mapped records from a write statement', async () => {
        const rows = await db
            .createQueryBuilder('pgContract')
            .update({ title: 'updated' })
            .where({ id: 'a' })
            .returning('*')
            .execute<Array<{ id: string; title: string }>>();
        expect(rows).toEqual([expect.objectContaining({ id: 'a', title: 'updated' })]);
    });
});
