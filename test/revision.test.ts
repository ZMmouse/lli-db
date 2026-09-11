import { Database, ModelTableMigrator, SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

const revisionModel: IModel = {
    code: 'revisionRecord',
    name: 'revision record',
    tableName: 'revision_record',
    useRevision: true,
    attributes: {
        title: {
            code: 'title',
            name: 'title',
            columnName: 'title',
            type: SysFieldTypeEnum.TEXT,
            required: true,
        },
        updatedAt: {
            code: 'updatedAt',
            name: 'updated at',
            columnName: 'updated_at',
            type: SysFieldTypeEnum.DATETIME,
        },
    },
};

const createDatabase = async (strict = true) => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models: [revisionModel],
        validation: strict ? { mode: 'strict' } : undefined,
    });
    await new ModelTableMigrator(db).syncAll();
    return db;
};

describe('revision optimistic concurrency', () => {
    test('uses the registered revision expansion field lifecycle', async () => {
        const db = await createDatabase(false);
        try {
            expect(db.modelStore.get('revisionRecord').attributes.revision.type).toBe(
                SysExpansionFieldTypeEnum.REVISION,
            );
            expect(db.fieldTypeManager.get(SysExpansionFieldTypeEnum.REVISION).dbFiledType).toBe(
                'int',
            );

            const created = await db
                .query<{ id: string; revision: number }>('revisionRecord')
                .create({
                    data: { title: 'created', revision: 99 },
                });
            expect(created.revision).toBe(1);

            const updated = await db.query<{ revision: number }>('revisionRecord').update({
                where: { id: created.id },
                data: { title: 'updated', revision: 99 },
            });
            expect(updated?.revision).toBe(2);

            await db.query('revisionRecord').updateMany({
                where: { id: created.id },
                data: { revision: 99 },
            });
            await expect(
                db.query('revisionRecord').findOne({ where: { id: created.id } }),
            ).resolves.toMatchObject({ revision: 2 });
        } finally {
            await db.close();
        }
    });

    test('creates at revision one and prevents caller writes', async () => {
        const db = await createDatabase();
        try {
            await expect(
                db.query('revisionRecord').create({ data: { title: 'created', revision: 9 } }),
            ).rejects.toMatchObject({ code: 'LLI40020' });

            const row = await db.query<Record<string, unknown>>('revisionRecord').create({
                data: { title: 'created' },
            });
            expect(row).toMatchObject({ title: 'created', revision: 1 });
            const rows = await db.query<Record<string, unknown>>('revisionRecord').createMany({
                data: [{ title: 'many-1' }, { title: 'many-2' }],
            });
            expect(rows.map((item) => item.revision)).toEqual([1, 1]);
        } finally {
            await db.close();
        }
    });

    test('atomically compares and increments revision', async () => {
        const db = await createDatabase();
        try {
            const created = await db
                .query<{ id: string; revision: number }>('revisionRecord')
                .create({
                    data: { title: 'created' },
                });

            const updated = await db.query<Record<string, unknown>>('revisionRecord').update({
                where: { id: created.id },
                data: { title: 'updated' },
                expectedRevision: 1,
            });
            expect(updated).toMatchObject({ title: 'updated', revision: 2 });
            const beforeConflict = await db
                .query<{ updatedAt: Date }>('revisionRecord')
                .findOne({ where: { id: created.id } });
            await new Promise((resolve) => setTimeout(resolve, 5));

            await expect(
                db.query('revisionRecord').update({
                    where: { id: created.id },
                    data: { title: 'stale' },
                    expectedRevision: 1,
                }),
            ).rejects.toMatchObject({ code: 'LLI40901' });

            await expect(
                db.query('revisionRecord').findOne({ where: { id: created.id } }),
            ).resolves.toMatchObject({
                title: 'updated',
                revision: 2,
                updatedAt: beforeConflict?.updatedAt,
            });
        } finally {
            await db.close();
        }
    });

    test('query builder returns affected rows from the atomic update statement', async () => {
        const db = await createDatabase();
        try {
            const created = await db.query<{ id: string }>('revisionRecord').create({
                data: { title: 'before builder update' },
            });
            await expect(
                db
                    .createQueryBuilder('revisionRecord')
                    .update({ title: 'after builder update' })
                    .increment('revision')
                    .where({ id: created.id, revision: 1 })
                    .returning('*')
                    .executeMutation(),
            ).resolves.toEqual({
                count: 1,
                rows: [
                    expect.objectContaining({
                        id: created.id,
                        title: 'after builder update',
                        revision: 2,
                    }),
                ],
            });
        } finally {
            await db.close();
        }
    });

    test('allows only one update for the same expected revision', async () => {
        const db = await createDatabase();
        try {
            const created = await db.query<{ id: string }>('revisionRecord').create({
                data: { title: 'created' },
            });
            const results = await Promise.allSettled([
                db.query('revisionRecord').update({
                    where: { id: created.id },
                    data: { title: 'first' },
                    expectedRevision: 1,
                }),
                db.query('revisionRecord').update({
                    where: { id: created.id },
                    data: { title: 'second' },
                    expectedRevision: 1,
                }),
            ]);
            expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
            const rejected = results.find((result) => result.status === 'rejected');
            expect(rejected).toMatchObject({ reason: { code: 'LLI40901' } });
        } finally {
            await db.close();
        }
    });

    test('increments revision for last-write-wins updates', async () => {
        const db = await createDatabase();
        try {
            const created = await db.query<{ id: string }>('revisionRecord').create({
                data: { title: 'created' },
            });
            await expect(
                db.query('revisionRecord').update({
                    where: { id: created.id },
                    data: { title: 'updated' },
                }),
            ).resolves.toMatchObject({ revision: 2 });
        } finally {
            await db.close();
        }
    });

    test('atomically guards delete with expected revision', async () => {
        const db = await createDatabase();
        try {
            const created = await db.query<{ id: string }>('revisionRecord').create({
                data: { title: 'created' },
            });
            await expect(
                db.query('revisionRecord').delete({
                    where: { id: created.id },
                    expectedRevision: 2,
                }),
            ).rejects.toMatchObject({ code: 'LLI40901' });
            await expect(
                db.query('revisionRecord').delete({
                    where: { id: created.id },
                    expectedRevision: 1,
                }),
            ).resolves.toBe(1);
            await expect(
                db.query('revisionRecord').findOne({ where: { id: created.id } }),
            ).resolves.toBeNull();
        } finally {
            await db.close();
        }
    });

    test('supports atomic logical delete with revision', async () => {
        const db = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            },
            models: [
                {
                    ...revisionModel,
                    attributes: { ...revisionModel.attributes },
                    useLogicDelete: true,
                },
            ],
            modelConfig: {
                userModelCode: 'revisionRecord',
                userModelDisplayCode: 'title',
            },
            validation: { mode: 'strict' },
        });
        await new ModelTableMigrator(db).syncAll();
        try {
            const updateTarget = await db.query<{ id: string }>('revisionRecord').create({
                data: { title: 'before update' },
            });
            await expect(
                db.query('revisionRecord').update({
                    where: { id: updateTarget.id },
                    expectedRevision: 1,
                    data: { title: 'after update' },
                }),
            ).resolves.toMatchObject({ title: 'after update', revision: 2 });
            await expect(
                db.query('revisionRecord').update({
                    where: { id: updateTarget.id },
                    expectedRevision: 1,
                    data: { title: 'stale update' },
                }),
            ).rejects.toMatchObject({ code: 'LLI40901' });

            const created = await db.query<{ id: string }>('revisionRecord').create({
                data: { title: 'created' },
            });
            await expect(
                db.query('revisionRecord').delete({
                    where: { id: created.id },
                    expectedRevision: 2,
                }),
            ).rejects.toMatchObject({ code: 'LLI40901' });
            await expect(
                db.query('revisionRecord').delete({
                    where: { id: created.id },
                    expectedRevision: 1,
                }),
            ).resolves.toBe(1);
            const raw = await db.knex('revision_record').where({ id: created.id }).first();
            expect(raw).toMatchObject({ deleted: 1, revision: 2 });
            await expect(
                db.query('revisionRecord').delete({
                    where: { id: created.id },
                    expectedRevision: 2,
                }),
            ).rejects.toMatchObject({ code: 'LLI40901' });
            await expect(
                db.query('revisionRecord').delete({ where: { id: created.id } }),
            ).resolves.toBe(0);
            await expect(
                db.knex('revision_record').where({ id: created.id }).first(),
            ).resolves.toMatchObject({ deleted: 1, revision: 2 });
            await expect(
                db.query('revisionRecord').update({
                    where: { id: created.id },
                    expectedRevision: 2,
                    data: { title: 'must stay deleted' },
                }),
            ).rejects.toMatchObject({ code: 'LLI40901' });

            const lastWriteWins = await db.query<{ id: string }>('revisionRecord').create({
                data: { title: 'last-write-wins' },
            });
            await expect(
                db.query('revisionRecord').delete({ where: { id: lastWriteWins.id } }),
            ).resolves.toBe(1);
            await expect(
                db.knex('revision_record').where({ id: lastWriteWins.id }).first(),
            ).resolves.toMatchObject({ deleted: 1, revision: 2 });
        } finally {
            await db.close();
        }
    });

    test('rejects invalid revision parameters', async () => {
        const db = await createDatabase();
        try {
            await expect(
                db.query('revisionRecord').update({
                    where: { title: 'created' },
                    data: { title: 'bad' },
                    expectedRevision: 1,
                }),
            ).rejects.toMatchObject({ code: 'LLI400' });
            await expect(
                db.query('revisionRecord').update({
                    where: { id: 'record-id', title: 'created' },
                    data: { title: 'bad' },
                    expectedRevision: 1,
                }),
            ).rejects.toMatchObject({ code: 'LLI400' });
        } finally {
            await db.close();
        }
    });
});
