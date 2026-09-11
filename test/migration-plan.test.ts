import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildMigrationPlan, Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';

const createModel = (version: 1 | 2): IModel => ({
    code: 'planTest',
    name: 'plan test',
    tableName: 'plan_test',
    attributes: {
        title: {
            code: 'title',
            name: 'title',
            columnName: 'title',
            type: SysFieldTypeEnum.TEXT,
            ...(version === 2 ? { length: 40, required: true } : {}),
        },
        ...(version === 1
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
});

const createDatabase = (filename: string, model: IModel) =>
    new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models: [model],
    });

describe('migration planning and operational safety', () => {
    test('dryRun returns a plan without creating tables or snapshots', async () => {
        const db = createDatabase(':memory:', createModel(1));
        const migrator = new ModelTableMigrator(db);

        try {
            const plan = await migrator.dryRun();

            expect(plan.hasChanges).toBe(true);
            expect(plan.requiresBackup).toBe(false);
            expect(plan.operations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: 'createTable', modelCode: 'planTest' }),
                ]),
            );
            await expect(db.knex.schema.hasTable('plan_test')).resolves.toBe(false);
            await expect(db.knex.schema.hasTable('lli_model_record')).resolves.toBe(false);
        } finally {
            await db.knex.destroy();
        }
    });

    test('destructive changes require explicit confirmation and expose the plan', async () => {
        const db = createDatabase(':memory:', createModel(1));
        const migrator = new ModelTableMigrator(db);

        try {
            await migrator.syncAll();
            db.modelStore.add(createModel(2));

            const plan = await migrator.dryRun();
            expect(plan.requiresBackup).toBe(true);
            expect(plan.operations).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        type: 'dropColumn',
                        target: 'legacy',
                        destructive: true,
                    }),
                    expect.objectContaining({
                        type: 'alterColumn',
                        target: 'title',
                        destructive: true,
                    }),
                ]),
            );

            await expect(migrator.syncAll()).rejects.toMatchObject({
                code: 'LLI400',
                detail: { migrationPlan: expect.objectContaining({ requiresBackup: true }) },
            });
            await expect(db.knex.schema.hasColumn('plan_test', 'legacy')).resolves.toBe(true);
            await expect(migrator.getMigrationStatus()).resolves.toMatchObject({
                status: 'ready',
                error: null,
            });
            await expect(migrator.syncAll({ allowDestructive: true })).resolves.toBe(true);
            await expect(db.knex.schema.hasColumn('plan_test', 'legacy')).resolves.toBe(false);
        } finally {
            await db.knex.destroy();
        }
    });

    test('removed models are reported for manual review without dropping their tables', async () => {
        const retainedModel: IModel = {
            code: 'retained',
            name: 'retained',
            tableName: 'retained',
            attributes: {},
        };
        const db = createDatabase(':memory:', createModel(1));
        const migrator = new ModelTableMigrator(db);

        try {
            await migrator.syncAll();
            db.modelStore.add(retainedModel);
            const currentModels = db.modelStore
                .getModels()
                .filter((model) => model.code !== 'planTest');
            const previousModels = await migrator.getPreBootStrapModels();
            const plan = buildMigrationPlan(currentModels, previousModels);

            expect(plan.operations).toContainEqual(
                expect.objectContaining({ type: 'orphanTable', modelCode: 'planTest' }),
            );
            await expect(db.knex.schema.hasTable('plan_test')).resolves.toBe(true);
        } finally {
            await db.knex.destroy();
        }
    });

    test('two database instances targeting the same SQLite file migrate serially', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'lli-db-migration-lock-'));
        const filename = join(directory, 'shared.sqlite3');
        const firstDb = createDatabase(filename, createModel(1));
        const secondDb = createDatabase(filename, createModel(1));
        const firstMigrator = new ModelTableMigrator(firstDb);
        const secondMigrator = new ModelTableMigrator(secondDb);
        let active = 0;
        let maximumActive = 0;

        const wrapSync = (migrator: ModelTableMigrator) => {
            const original = migrator.sync.bind(migrator);
            jest.spyOn(migrator, 'sync').mockImplementation(async (...args) => {
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
                try {
                    return await original(...args);
                } finally {
                    active -= 1;
                }
            });
        };
        wrapSync(firstMigrator);
        wrapSync(secondMigrator);

        try {
            await expect(
                Promise.all([firstMigrator.syncAll(), secondMigrator.syncAll()]),
            ).resolves.toEqual([true, true]);
            expect(maximumActive).toBe(1);
            const rows = await firstDb.knex('lli_model_record').where({ code: 'lliModelRecord' });
            expect(rows).toHaveLength(1);
        } finally {
            await firstDb.knex.destroy();
            await secondDb.knex.destroy();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    (process.platform === 'win32' ? test : test.skip)(
        'normalizes Windows path casing before acquiring a SQLite migration lock',
        async () => {
            const directory = mkdtempSync(join(tmpdir(), 'lli-db-migration-case-lock-'));
            const filename = join(directory, 'shared.sqlite3');
            const alternateFilename = `${filename[0] === filename[0].toUpperCase() ? filename[0].toLowerCase() : filename[0].toUpperCase()}${filename.slice(1)}`;
            const firstDb = createDatabase(filename, createModel(1));
            const secondDb = createDatabase(alternateFilename, createModel(1));
            const firstMigrator = new ModelTableMigrator(firstDb);
            const secondMigrator = new ModelTableMigrator(secondDb);
            let active = 0;
            let maximumActive = 0;

            const wrapSync = (migrator: ModelTableMigrator) => {
                const original = migrator.sync.bind(migrator);
                jest.spyOn(migrator, 'sync').mockImplementation(async (...args) => {
                    active += 1;
                    maximumActive = Math.max(maximumActive, active);
                    await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
                    try {
                        return await original(...args);
                    } finally {
                        active -= 1;
                    }
                });
            };
            wrapSync(firstMigrator);
            wrapSync(secondMigrator);

            try {
                expect(alternateFilename).not.toBe(filename);
                await expect(
                    Promise.all([firstMigrator.syncAll(), secondMigrator.syncAll()]),
                ).resolves.toEqual([true, true]);
                expect(maximumActive).toBe(1);
            } finally {
                await firstDb.knex.destroy();
                await secondDb.knex.destroy();
                rmSync(directory, { recursive: true, force: true });
            }
        },
    );

    test('migrates revision on with existing rows and treats removing it as destructive', async () => {
        const directory = mkdtempSync(join(tmpdir(), 'lli-db-revision-migration-'));
        const filename = join(directory, 'revision.sqlite3');
        const revisionModel = (useRevision: boolean): IModel => ({
            code: 'revisionMigration',
            name: 'revision migration',
            tableName: 'revision_migration',
            useRevision,
            attributes: {
                title: {
                    code: 'title',
                    name: 'title',
                    columnName: 'title',
                    type: SysFieldTypeEnum.TEXT,
                },
            },
        });
        const first = createDatabase(filename, revisionModel(false));
        await new ModelTableMigrator(first).syncAll();
        await first.knex('revision_migration').insert({ id: 'old', title: 'old row' });
        await first.close();

        const second = createDatabase(filename, revisionModel(true));
        try {
            await new ModelTableMigrator(second).syncAll();
            await expect(
                second.knex('revision_migration').where({ id: 'old' }).first(),
            ).resolves.toMatchObject({ revision: 1 });
        } finally {
            await second.close();
        }

        const third = createDatabase(filename, revisionModel(false));
        try {
            const plan = await new ModelTableMigrator(third).dryRun();
            expect(plan).toMatchObject({ requiresBackup: true });
            expect(plan.operations).toContainEqual(
                expect.objectContaining({
                    type: 'dropColumn',
                    target: 'revision',
                    destructive: true,
                }),
            );
        } finally {
            await third.close();
            rmSync(directory, { recursive: true, force: true });
        }
    });

    test('rolls back an added required column when stored-data validation fails', async () => {
        const db = createDatabase(':memory:', createModel(1));
        const migrator = new ModelTableMigrator(db);
        try {
            await migrator.syncAll();
            await db.knex('plan_test').insert({ id: 'existing', title: 'row' });
            const upgraded = createModel(1);
            upgraded.attributes.score = {
                code: 'score',
                name: 'score',
                columnName: 'score',
                type: SysFieldTypeEnum.INT,
                required: true,
                default: 'invalid-integer' as never,
            };
            db.modelStore.add(upgraded);

            await expect(migrator.syncAll({ validateStoredData: true })).rejects.toMatchObject({
                code: 'LLI40020',
            });
            await expect(db.knex.schema.hasColumn('plan_test', 'score')).resolves.toBe(false);
        } finally {
            await db.close();
        }
    });
});
