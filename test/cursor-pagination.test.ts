import { Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

interface CursorRecord {
    id: string;
    group: string;
    rank: number | null;
    title: string;
}

const model: IModel = {
    code: 'cursorRecord',
    name: 'cursor record',
    tableName: 'cursor_record',
    attributes: {
        group: {
            code: 'group',
            name: 'group',
            columnName: 'group_code',
            type: SysFieldTypeEnum.TEXT,
            required: true,
        },
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
        payload: {
            code: 'payload',
            name: 'payload',
            columnName: 'payload_json',
            type: SysFieldTypeEnum.JSON,
        },
        owner: {
            code: 'owner',
            name: 'owner',
            columnName: 'owner_id',
            type: SysFieldTypeEnum.SINGLE_QUOTE,
            refCode: 'cursorOwner',
            refFieldCode: 'id',
            refDisplayCode: 'name',
        },
    },
};

const ownerModel: IModel = {
    code: 'cursorOwner',
    name: 'cursor owner',
    tableName: 'cursor_owner',
    attributes: {
        name: {
            code: 'name',
            name: 'name',
            columnName: 'name',
            type: SysFieldTypeEnum.TEXT,
        },
    },
};

const createDatabase = async () => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models: [model, ownerModel],
        validation: { mode: 'strict' },
        query: { maxLimit: 100 },
    });
    await new ModelTableMigrator(db).syncAll();
    await db.knex('cursor_record').insert([
        { id: 'a', group_code: 'one', rank_value: 1, title_text: 'Alpha' },
        { id: 'b', group_code: 'one', rank_value: 1, title_text: 'alpha' },
        { id: 'c', group_code: 'one', rank_value: 2, title_text: 'Beta' },
        { id: 'd', group_code: 'one', rank_value: null, title_text: 'Null one' },
        { id: 'e', group_code: 'one', rank_value: null, title_text: 'Null two' },
        { id: 'z', group_code: 'two', rank_value: 0, title_text: 'Other' },
    ]);
    return db;
};

describe('keyset cursor pagination', () => {
    test('walks duplicate and null values without duplicates or omissions', async () => {
        const db = await createDatabase();
        try {
            const seen: string[] = [];
            let after: Record<string, string | number | boolean | null> | undefined;
            do {
                const page = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                    where: { group: 'one' },
                    orderBy: [{ field: 'rank', direction: 'asc' }],
                    limit: 2,
                    ...(after ? { after } : {}),
                });
                seen.push(...page.rows.map((row) => row.id));
                after = page.nextPosition;
            } while (after);

            expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
            expect(new Set(seen).size).toBe(seen.length);
        } finally {
            await db.close();
        }
    });

    test('walks an all-null sort dataset using the id tie-breaker', async () => {
        const db = await createDatabase();
        try {
            await db.knex('cursor_record').insert([
                { id: 'n3', group_code: 'nulls', rank_value: null, title_text: 'third' },
                { id: 'n1', group_code: 'nulls', rank_value: null, title_text: 'first' },
                { id: 'n2', group_code: 'nulls', rank_value: null, title_text: 'second' },
            ]);
            const seen: string[] = [];
            let after: Record<string, string | number | boolean | null> | undefined;
            do {
                const page = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                    where: { group: 'nulls' },
                    orderBy: [{ field: 'rank', direction: 'asc' }],
                    limit: 1,
                    ...(after ? { after } : {}),
                });
                seen.push(...page.rows.map((row) => row.id));
                after = page.nextPosition;
            } while (after);
            expect(seen).toEqual(['n1', 'n2', 'n3']);
        } finally {
            await db.close();
        }
    });

    test('returns a structural position and ignores inserts before it', async () => {
        const db = await createDatabase();
        try {
            const first = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                where: { group: 'one' },
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
            });
            expect(first.rows.map((row) => row.id)).toEqual(['a', 'b']);
            expect(first.nextPosition).toEqual({ rank: 1, id: 'b' });

            await db.knex('cursor_record').insert({
                id: '0',
                group_code: 'one',
                rank_value: 0,
                title_text: 'inserted before',
            });
            const second = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                where: { group: 'one' },
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
                after: first.nextPosition,
            });
            expect(second.rows.map((row) => row.id)).toEqual(['c', 'd']);
        } finally {
            await db.close();
        }
    });

    test('supports descending order and case-sensitive contains', async () => {
        const db = await createDatabase();
        try {
            const page = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                where: { group: 'one' },
                orderBy: [{ field: 'rank', direction: 'desc' }],
                limit: 3,
            });
            expect(page.rows.map((row) => row.id)).toEqual(['c', 'a', 'b']);

            const upper = await db.query<CursorRecord>('cursorRecord').findMany({
                where: { title: { containsCaseSensitive: 'A' } },
            });
            expect(upper.map((row) => row.id)).toEqual(['a']);
        } finally {
            await db.close();
        }
    });

    test('walks a mixed-direction compound order', async () => {
        const db = await createDatabase();
        try {
            const seen: string[] = [];
            let after: Record<string, string | number | boolean | null> | undefined;
            do {
                const page = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                    orderBy: [
                        { field: 'group', direction: 'asc' },
                        { field: 'rank', direction: 'desc' },
                    ],
                    limit: 2,
                    ...(after ? { after } : {}),
                });
                seen.push(...page.rows.map((row) => row.id));
                after = page.nextPosition;
            } while (after);
            expect(seen).toEqual(['c', 'a', 'b', 'd', 'e', 'z']);
        } finally {
            await db.close();
        }
    });

    test('continues after the cursor row is deleted', async () => {
        const db = await createDatabase();
        try {
            const first = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                where: { group: 'one' },
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
            });
            await db.knex('cursor_record').where({ id: 'b' }).delete();
            const second = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                where: { group: 'one' },
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
                after: first.nextPosition,
            });
            expect(second.rows.map((row) => row.id)).toEqual(['c', 'd']);
        } finally {
            await db.close();
        }
    });

    test('uses the structural position when a prior row changes its sort value', async () => {
        const db = await createDatabase();
        try {
            const first = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                where: { group: 'one' },
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
            });
            await db.knex('cursor_record').where({ id: 'a' }).update({ rank_value: 99 });
            const second = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                where: { group: 'one' },
                orderBy: [{ field: 'rank', direction: 'asc' }],
                limit: 2,
                after: first.nextPosition,
            });
            expect(second.rows.map((row) => row.id)).toEqual(['c', 'a']);
        } finally {
            await db.close();
        }
    });

    test('walks a three-field order with the id tie-breaker', async () => {
        const db = await createDatabase();
        try {
            const seen: string[] = [];
            let after: Record<string, string | number | boolean | null> | undefined;
            do {
                const page = await db.query<CursorRecord>('cursorRecord').findCursorPage({
                    orderBy: [
                        { field: 'group', direction: 'asc' },
                        { field: 'rank', direction: 'asc' },
                        { field: 'title', direction: 'desc' },
                    ],
                    limit: 2,
                    ...(after ? { after } : {}),
                });
                seen.push(...page.rows.map((row) => row.id));
                after = page.nextPosition;
            } while (after);
            expect(seen).toHaveLength(6);
            expect(new Set(seen)).toEqual(new Set(['a', 'b', 'c', 'd', 'e', 'z']));
        } finally {
            await db.close();
        }
    });

    test('database close drains a cursor query that has already started', async () => {
        const db = await createDatabase();
        let entered!: () => void;
        let release!: () => void;
        const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
        const releasePromise = new Promise<void>((resolve) => (release = resolve));
        const runOperation = db.runOperation.bind(db);
        jest.spyOn(db, 'runOperation').mockImplementation((callback) =>
            runOperation(async () => {
                entered();
                await releasePromise;
                return callback();
            }),
        );

        const cursorPromise = db.query<CursorRecord>('cursorRecord').findCursorPage({
            orderBy: [{ field: 'rank', direction: 'asc' }],
            limit: 2,
        });
        await enteredPromise;
        let closed = false;
        const closePromise = db.close().then(() => {
            closed = true;
        });
        await Promise.resolve();
        expect(closed).toBe(false);
        release();
        await expect(cursorPromise).resolves.toMatchObject({ rows: expect.any(Array) });
        await closePromise;
        expect(closed).toBe(true);
    });

    test.each([
        ['missing order', { orderBy: [] }],
        [
            'duplicate order',
            {
                orderBy: [
                    { field: 'rank', direction: 'asc' },
                    { field: 'rank', direction: 'desc' },
                ],
            },
        ],
        ['unknown order', { orderBy: [{ field: 'missing', direction: 'asc' }] }],
        ['json order', { orderBy: [{ field: 'payload', direction: 'asc' }] }],
        ['relation order', { orderBy: [{ field: 'owner', direction: 'asc' }] }],
        [
            'incomplete after',
            { orderBy: [{ field: 'rank', direction: 'asc' }], after: { rank: 1 } },
        ],
        [
            'extra after field',
            {
                orderBy: [{ field: 'rank', direction: 'asc' }],
                after: { rank: 1, id: 'a', title: 'extra' },
            },
        ],
        [
            'coerced after type',
            {
                orderBy: [{ field: 'rank', direction: 'asc' }],
                after: { rank: '1', id: 'a' },
            },
        ],
        [
            'non-finite after number',
            {
                orderBy: [{ field: 'rank', direction: 'asc' }],
                after: { rank: Number.NaN, id: 'a' },
            },
        ],
    ])('rejects %s', async (_label, params) => {
        const db = await createDatabase();
        try {
            await expect(
                db.query('cursorRecord').findCursorPage(params as never),
            ).rejects.toMatchObject({ code: 'LLI40021' });
        } finally {
            await db.close();
        }
    });
});
