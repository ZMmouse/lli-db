import { Database, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';
import { ModelTableMigrator } from '../libs/migrator';

const createDatabase = (model: IModel) =>
    new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models: [model],
    });

const createModel = (
    code: string,
    tableName: string,
    options: {
        description?: boolean;
        requiredDescription?: boolean;
        legacy?: boolean;
        uniqueIndex?: boolean;
    } = {},
): IModel => ({
    code,
    name: code,
    tableName,
    attributes: {
        title: {
            code: 'title',
            name: 'title',
            columnName: 'title',
            type: SysFieldTypeEnum.TEXT,
        },
        ...(options.description
            ? {
                  description: {
                      code: 'description',
                      name: 'description',
                      columnName: 'description',
                      type: SysFieldTypeEnum.TEXT,
                      required: options.requiredDescription,
                  },
              }
            : {}),
        ...(options.legacy
            ? {
                  legacy: {
                      code: 'legacy',
                      name: 'legacy',
                      columnName: 'legacy',
                      type: SysFieldTypeEnum.TEXT,
                  },
              }
            : {}),
    },
    indexes: options.uniqueIndex
        ? [{ name: `uq_${tableName}_title`, codes: ['title'], type: 'unique' }]
        : [],
});

const readSnapshot = async (db: Database) => {
    const row = await db.knex('lli_model_record')
        .where({ code: 'lliModelRecord' })
        .first(['models', 'status', 'error']);
    return {
        ...row,
        models: typeof row.models === 'string' ? JSON.parse(row.models) : row.models,
    } as { models: IModel[]; status: string; error: string | null };
};

const findSnapshotModel = (snapshot: Awaited<ReturnType<typeof readSnapshot>>, code: string) =>
    snapshot.models.find((model) => model.code === code)!;

describe('ModelTableMigrator failure recovery', () => {
    test('create-table failure is thrown, rolled back, and can be retried', async () => {
        const invalidModel: IModel = {
            code: 'createFailure',
            name: 'create failure',
            tableName: 'create_failure',
            attributes: {
                broken: {
                    code: 'broken',
                    name: 'broken',
                    columnName: 'broken',
                    type: 'BrokenDdlField',
                },
            },
        };
        const db = createDatabase(invalidModel);
        const migrator = new ModelTableMigrator(db);
        db.fieldTypeManager.extends({
            name: 'BrokenDdlField',
            dbFiledType: 'unsupported' as never,
            toDB: (value) => value,
            fromDB: (value) => value,
        });

        try {
            await expect(migrator.syncAll()).rejects.toThrow('Unsupported field type');
            await expect(db.knex.schema.hasTable('create_failure')).resolves.toBe(false);
            await expect(db.knex.schema.hasTable('lli_model_record')).resolves.toBe(false);

            db.modelStore.add(createModel('createFailure', 'create_failure'));
            await expect(migrator.syncAll()).resolves.toBe(true);
            await expect(db.knex.schema.hasTable('create_failure')).resolves.toBe(true);
            expect(findSnapshotModel(await readSnapshot(db), 'createFailure')).toBeDefined();
        } finally {
            await db.knex.destroy();
        }
    });

    test('add-column failure preserves the old schema and snapshot before retry', async () => {
        const code = 'columnFailure';
        const tableName = 'column_failure';
        const db = createDatabase(createModel(code, tableName));
        const migrator = new ModelTableMigrator(db);

        try {
            await migrator.syncAll();
            await db.knex(tableName).insert({ id: 'existing', title: 'existing' });
            const oldSnapshotModel = findSnapshotModel(await readSnapshot(db), code);

            db.modelStore.add(
                createModel(code, tableName, { description: true, requiredDescription: true }),
            );
            await expect(migrator.syncAll()).rejects.toMatchObject({ code: 'SQLITE_ERROR' });

            const columnsAfterFailure = await db.knex(tableName).columnInfo();
            expect(Object.keys(columnsAfterFailure).sort()).toEqual(['id', 'title']);
            const failedSnapshot = await readSnapshot(db);
            expect(findSnapshotModel(failedSnapshot, code)).toEqual(oldSnapshotModel);
            expect(failedSnapshot.status).toBe('failed');
            expect(failedSnapshot.error).toEqual(expect.any(String));
            await expect(migrator.getMigrationStatus()).resolves.toMatchObject({
                status: 'failed',
                error: expect.any(String),
            });

            db.modelStore.add(createModel(code, tableName, { description: true }));
            await expect(migrator.syncAll()).resolves.toBe(true);
            expect(await db.knex.schema.hasColumn(tableName, 'description')).toBe(true);
            const recoveredSnapshot = await readSnapshot(db);
            expect(findSnapshotModel(recoveredSnapshot, code).attributes).toHaveProperty(
                'description',
            );
            expect(recoveredSnapshot.status).toBe('ready');
            expect(recoveredSnapshot.error).toBeNull();
            await expect(migrator.getMigrationStatus()).resolves.toMatchObject({
                status: 'ready',
                error: null,
            });
        } finally {
            await db.knex.destroy();
        }
    });

    test('index failure rolls back and leaves the previous snapshot retryable', async () => {
        const code = 'indexFailure';
        const tableName = 'index_failure';
        const db = createDatabase(createModel(code, tableName));
        const migrator = new ModelTableMigrator(db);

        try {
            await migrator.syncAll();
            await db.knex(tableName).insert([
                { id: '1', title: 'duplicate' },
                { id: '2', title: 'duplicate' },
            ]);
            const oldSnapshotModel = findSnapshotModel(await readSnapshot(db), code);

            db.modelStore.add(createModel(code, tableName, { uniqueIndex: true }));
            await expect(migrator.syncAll()).rejects.toMatchObject({
                code: 'SQLITE_CONSTRAINT_UNIQUE',
            });

            const indexesAfterFailure = await db.knex.raw(`PRAGMA index_list('${tableName}')`);
            expect(indexesAfterFailure.map((index: { name: string }) => index.name)).not.toContain(
                `uq_${tableName}_title`,
            );
            expect(findSnapshotModel(await readSnapshot(db), code)).toEqual(oldSnapshotModel);

            await db.knex(tableName).where({ id: '2' }).delete();
            await expect(migrator.syncAll()).resolves.toBe(true);
            const indexesAfterRetry = await db.knex.raw(`PRAGMA index_list('${tableName}')`);
            expect(indexesAfterRetry.map((index: { name: string }) => index.name)).toContain(
                `uq_${tableName}_title`,
            );
            expect(findSnapshotModel(await readSnapshot(db), code).indexes).toEqual([
                { name: `uq_${tableName}_title`, codes: ['title'], type: 'unique' },
            ]);
        } finally {
            await db.knex.destroy();
        }
    });

    test('drop-column failure preserves state and can retry the same target model', async () => {
        const code = 'dropFailure';
        const tableName = 'drop_failure';
        const db = createDatabase(createModel(code, tableName, { legacy: true }));
        const migrator = new ModelTableMigrator(db);

        try {
            await migrator.syncAll();
            const oldSnapshotModel = findSnapshotModel(await readSnapshot(db), code);
            await db.knex.raw(
                `CREATE VIEW drop_failure_legacy_view AS SELECT legacy FROM ${tableName}`,
            );

            db.modelStore.add(createModel(code, tableName));
            await expect(
                migrator.syncAll({ allowDestructive: true }),
            ).rejects.toMatchObject({ code: 'SQLITE_ERROR' });

            expect(await db.knex.schema.hasColumn(tableName, 'legacy')).toBe(true);
            expect(findSnapshotModel(await readSnapshot(db), code)).toEqual(oldSnapshotModel);

            await db.knex.raw('DROP VIEW drop_failure_legacy_view');
            await expect(migrator.syncAll({ allowDestructive: true })).resolves.toBe(true);

            expect(await db.knex.schema.hasColumn(tableName, 'legacy')).toBe(false);
            expect(findSnapshotModel(await readSnapshot(db), code).attributes).not.toHaveProperty(
                'legacy',
            );
        } finally {
            await db.knex.destroy();
        }
    });

    test('concurrent syncAll calls are serialized for the same database instance', async () => {
        const db = createDatabase(createModel('concurrentMigration', 'concurrent_migration'));
        const firstMigrator = new ModelTableMigrator(db);
        const secondMigrator = new ModelTableMigrator(db);

        try {
            await expect(Promise.all([firstMigrator.syncAll(), secondMigrator.syncAll()])).resolves
                .toEqual([true, true]);
            const rows = await db.knex('lli_model_record').where({ code: 'lliModelRecord' });
            expect(rows).toHaveLength(1);
            expect(rows[0].status).toBe('ready');
        } finally {
            await db.knex.destroy();
        }
    });
});
