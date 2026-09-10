import { Database, SysFieldTypeEnum, validateModels } from '../libs';
import type { IAttribute, IModel } from '../libs';
import { ModelTableMigrator } from '../libs/migrator';
import exampleModels from '../examples/models';

const attribute = (code: string, columnName = code) => ({
    code,
    name: code,
    columnName,
    type: SysFieldTypeEnum.TEXT,
});

const model = (
    code: string,
    tableName = code,
    attributes: Record<string, IAttribute> = { title: attribute('title') },
): IModel => ({
    code,
    name: code,
    tableName,
    attributes,
});

const sqliteConfig = (models: IModel[]) => ({
    connection: {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
        pool: { min: 1, max: 1 },
    },
    models,
});

describe('validateModels', () => {
    test('accepts every bundled example model', () => {
        expect(validateModels(exampleModels)).toBe(true);
    });

    test('accepts forward relation, intermediate model, and parent-child references', () => {
        const models: IModel[] = [
            {
                ...model('article'),
                childCodes: ['articleComment'],
                attributes: {
                    title: attribute('title'),
                    tags: {
                        code: 'tags',
                        name: 'tags',
                        columnName: 'tags',
                        type: SysFieldTypeEnum.MULTI_QUOTE,
                        refCode: 'tag',
                        refFieldCode: 'id',
                        refDisplayCode: 'name',
                        midCode: 'articleTag',
                        selfInMidFieldCode: 'articleId',
                        refInMidFieldCode: 'tagId',
                    },
                },
            },
            { ...model('tag'), attributes: { name: attribute('name') } },
            {
                ...model('articleTag'),
                attributes: {
                    articleId: attribute('articleId'),
                    tagId: attribute('tagId'),
                },
            },
            {
                ...model('articleComment'),
                parentCode: 'article',
                parentRefFieldCode: 'articleId',
                attributes: { articleId: attribute('articleId') },
            },
        ];

        expect(validateModels(models)).toBe(true);
    });

    test('reports an exact attribute path before attempting to create a connection', () => {
        const invalid = model('article');
        invalid.attributes.title.code = 'description';

        expect(
            () =>
                new Database({
                    connection: undefined as never,
                    models: [invalid],
                }),
        ).toThrow(
            'Invalid model definition at models[0].attributes.title.code: expected "title", received "description"',
        );
    });

    test.each([
        {
            name: 'model code',
            models: [model('article', 'articles'), model('article', 'other_articles')],
            message: 'models[1].code: duplicate model code "article"',
        },
        {
            name: 'table name',
            models: [model('article', 'records'), model('tag', 'records')],
            message: 'models[1].tableName: duplicate table name "records"',
        },
        {
            name: 'column name',
            models: [
                model('article', 'articles', {
                    title: attribute('title', 'content'),
                    description: attribute('description', 'content'),
                }),
            ],
            message: 'models[0].attributes.description.columnName: duplicate column name "content"',
        },
    ])('rejects a duplicate $name', ({ models, message }) => {
        expect(() => validateModels(models)).toThrow(message);
    });

    test('rejects invalid index definitions', () => {
        const invalid = {
            ...model('article'),
            indexes: [{ name: 'idx_missing', codes: ['missing'] }],
        };

        expect(() => validateModels([invalid])).toThrow(
            'models[0].indexes[0].codes[0]: attribute "missing" does not exist on model "article"',
        );
    });

    test('rejects missing relation targets and intermediate fields', () => {
        const invalid = {
            ...model('article'),
            attributes: {
                tags: {
                    code: 'tags',
                    name: 'tags',
                    columnName: 'tags',
                    type: SysFieldTypeEnum.MULTI_QUOTE,
                    refCode: 'tag',
                    refFieldCode: 'id',
                    refDisplayCode: 'name',
                    midCode: 'articleTag',
                    selfInMidFieldCode: 'missingArticleId',
                    refInMidFieldCode: 'tagId',
                },
            },
        } as IModel;

        expect(() =>
            validateModels([
                invalid,
                { ...model('tag'), attributes: { name: attribute('name') } },
                {
                    ...model('articleTag'),
                    attributes: { articleId: attribute('articleId'), tagId: attribute('tagId') },
                },
            ]),
        ).toThrow(
            'models[0].attributes.tags.selfInMidFieldCode: attribute "missingArticleId" does not exist on model "articleTag"',
        );
    });

    test('rejects inconsistent child declarations', () => {
        const parent = { ...model('parent'), childCodes: ['child'] };
        const child = model('child');

        expect(() => validateModels([parent, child])).toThrow(
            'models[0].childCodes[0]: model "child" does not declare parentCode "parent"',
        );
    });

    test('checks custom field registration at migration time', async () => {
        const customModel = model('custom', 'custom', {
            value: { ...attribute('value'), type: 'CustomText' },
        });
        const db = new Database(sqliteConfig([customModel]));
        const migrator = new ModelTableMigrator(db);

        try {
            await expect(migrator.syncAll()).rejects.toMatchObject({
                code: 'LLI400',
                message:
                    'Invalid model definition at models[0].attributes.value.type: field type "CustomText" is not registered',
            });

            db.fieldTypeManager.extends({
                name: 'CustomText',
                inherit: SysFieldTypeEnum.TEXT,
            });
            await expect(migrator.syncAll()).resolves.toBe(true);
            await expect(db.knex.schema.hasTable('custom')).resolves.toBe(true);
        } finally {
            await db.knex.destroy();
        }
    });
});
