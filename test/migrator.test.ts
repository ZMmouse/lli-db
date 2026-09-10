import { Database } from '../libs';
import { diffModel, ModelTableMigrator } from '../libs/migrator';
import { SysFieldTypeEnum } from '../libs/database/enum/field-type-enum';
import type { IModel } from '../libs/database/types/model';

const createModel = (version: 1 | 2): IModel => ({
    code: 'migrationTest',
    name: '迁移测试',
    tableName: 'migration_test',
    attributes:
        version === 1
            ? {
                  title: {
                      code: 'title',
                      name: '标题',
                      columnName: 'title',
                      type: SysFieldTypeEnum.TEXT,
                      length: 20,
                      default: 'old',
                  },
                  legacy: {
                      code: 'legacy',
                      name: '旧字段',
                      columnName: 'legacy',
                      type: SysFieldTypeEnum.TEXT,
                  },
              }
            : {
                  title: {
                      code: 'title',
                      name: '标题',
                      columnName: 'display_title',
                      type: SysFieldTypeEnum.TEXT,
                      length: 50,
                      default: 'new',
                      required: true,
                      unique: true,
                  },
                  status: {
                      code: 'status',
                      name: '状态',
                      columnName: 'status',
                      type: SysFieldTypeEnum.TEXT,
                      default: 'pending',
                  },
              },
    indexes:
        version === 1
            ? [
                  { name: 'idx_migration_target', codes: ['title'] },
                  { name: 'idx_migration_legacy', codes: ['legacy'] },
              ]
            : [
                  { name: 'idx_migration_target', codes: ['status'] },
                  { name: 'idx_migration_status_unique', codes: ['status'], type: 'unique' },
              ],
});

describe('ModelTableMigrator', () => {
    test('保留每个字段属性的独立差异，并识别索引新增、删除和修改', () => {
        const oldModel = createModel(1);
        const newModel = createModel(2);
        const diff = diffModel(newModel, oldModel);

        expect(diff.attributes.added.map((attribute) => attribute.code)).toEqual(['status']);
        expect(diff.attributes.removed.map((attribute) => attribute.code)).toEqual(['legacy']);
        expect(diff.attributes.modified.title).toEqual({
            length: { oldValue: 20, newValue: 50 },
            default: { oldValue: 'old', newValue: 'new' },
            required: { oldValue: undefined, newValue: true },
            unique: { oldValue: undefined, newValue: true },
            columnName: { oldValue: 'title', newValue: 'display_title' },
        });

        expect(diff.indexes.removed.map((index) => index.name)).toEqual([
            'idx_migration_legacy',
            'idx_migration_target',
        ]);
        expect(diff.indexes.added.map((index) => index.name)).toEqual([
            'idx_migration_target',
            'idx_migration_status_unique',
        ]);

        const typeChangedModel = createModel(1);
        typeChangedModel.attributes.title.type = SysFieldTypeEnum.LONG_TEXT;
        expect(diffModel(typeChangedModel, createModel(1)).attributes.modified.title).toEqual({
            type: { oldValue: SysFieldTypeEnum.TEXT, newValue: SysFieldTypeEnum.LONG_TEXT },
        });
    });

    test('在 SQLite 中执行字段与索引的增量迁移', async () => {
        const db = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            },
            models: [createModel(1)],
            encrypt: {
                key: '12345678901234567890123456789012',
                iv: '1234567890123456',
            },
        });

        try {
            const migrator = new ModelTableMigrator(db);
            await migrator.syncAll();

            db.modelStore.add(createModel(2));
            await migrator.syncAll({ allowDestructive: true });

            const columns = await db.knex('migration_test').columnInfo();
            expect(Object.keys(columns)).toEqual(
                expect.arrayContaining(['id', 'display_title', 'status']),
            );
            expect(columns).not.toHaveProperty('title');
            expect(columns).not.toHaveProperty('legacy');
            expect(columns.display_title).toMatchObject({
                maxLength: '50',
                nullable: false,
                defaultValue: "'new'",
            });

            const indexes = await db.knex.raw("PRAGMA index_list('migration_test')");
            const indexNames = indexes.map((index: { name: string }) => index.name);
            expect(indexNames).toEqual(
                expect.arrayContaining(['idx_migration_target', 'idx_migration_status_unique']),
            );
            expect(indexNames).not.toContain('idx_migration_legacy');

            const targetIndexColumns = await db.knex.raw(
                "PRAGMA index_info('idx_migration_target')",
            );
            expect(targetIndexColumns.map((column: { name: string }) => column.name)).toEqual([
                'status',
            ]);

            const uniqueIndex = indexes.find(
                (index: { name: string }) => index.name === 'idx_migration_status_unique',
            );
            expect(uniqueIndex.unique).toBe(1);
        } finally {
            await db.knex.destroy();
        }
    });
});
