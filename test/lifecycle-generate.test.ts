import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IDatabaseConfig, IModel } from '../libs';

const models: IModel[] = [
    {
        code: 'workflowItem',
        name: 'workflow item',
        tableName: 'workflow_item',
        attributes: {
            title: {
                code: 'title',
                name: 'title',
                columnName: 'title',
                type: SysFieldTypeEnum.TEXT,
                required: true,
            },
        },
    },
];

const createDatabase = (config: Partial<IDatabaseConfig> = {}) => {
    return new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models,
        ...config,
    });
};

describe('lifecycle integration', () => {
    test('runs matching before/after hooks in order and preserves subscriber state', async () => {
        const db = createDatabase();
        await db.knex.schema.createTable('workflow_item', (table) => {
            table.string('id').primary();
            table.string('title').notNullable();
        });
        const calls: string[] = [];
        const unsubscribe = db.lifecycleProvider.subscribe({
            models: ['workflowItem'],
            async beforeCreate(event) {
                const data = event.params.data;
                if (!data || Array.isArray(data)) {
                    throw new Error('beforeCreate expected object data');
                }
                calls.push(`before:${data.title}`);
                event.state.originalTitle = data.title;
                data.title = 'changed-by-lifecycle';
                await Promise.resolve();
            },
            async afterCreate(event) {
                await Promise.resolve();
                calls.push(
                    `after:${event.state.originalTitle}:${(event.result as { title: string }).title}`,
                );
            },
        });
        const params = { data: { title: 'caller-title' } };

        try {
            const result = await db.query<{ id: string; title: string }>('workflowItem').create(params);

            expect(result.title).toBe('changed-by-lifecycle');
            expect(calls).toEqual([
                'before:caller-title',
                'after:caller-title:changed-by-lifecycle',
            ]);
            expect(params).toEqual({ data: { title: 'caller-title' } });

            unsubscribe();
            await db.query('workflowItem').create({ data: { title: 'after-unsubscribe' } });
            expect(calls).toHaveLength(2);
        } finally {
            await db.knex.destroy();
        }
    });
});

describe('configured type generation', () => {
    test('does not write types when canGenerateType is disabled', async () => {
        const appRoot = mkdtempSync(join(tmpdir(), 'lli-db-types-disabled-'));
        const typeOutDir = 'generated-types';
        const db = createDatabase({ appRoot, typeOutDir, canGenerateType: false });

        try {
            await new ModelTableMigrator(db).syncAll();
            expect(existsSync(join(appRoot, typeOutDir))).toBe(false);
        } finally {
            await db.knex.destroy();
            rmSync(appRoot, { recursive: true, force: true });
        }
    });

    test('writes public model types after a successful sync when enabled', async () => {
        const appRoot = mkdtempSync(join(tmpdir(), 'lli-db-types-enabled-'));
        const typeOutDir = 'generated-types';
        const db = createDatabase({ appRoot, typeOutDir, canGenerateType: true });

        try {
            await new ModelTableMigrator(db).syncAll();
            const outputDir = join(appRoot, typeOutDir);
            const content = readFileSync(join(outputDir, 'IWorkflowItem.ts'), 'utf8');

            expect(content).toContain('export interface IWorkflowItem');
            expect(content).toContain('id: string;');
            expect(content).toContain('title: string;');
            expect(existsSync(join(outputDir, 'ILliModelRecord.ts'))).toBe(false);
        } finally {
            await db.knex.destroy();
            rmSync(appRoot, { recursive: true, force: true });
        }
    });
});
