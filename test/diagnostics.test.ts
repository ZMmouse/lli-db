import { Database, ModelTableMigrator, SysFieldTypeEnum } from '../libs';
import type { IDiagnosticEvent, IDiagnosticLogger, IModel } from '../libs';

const secretValue = 'secret-value-that-must-not-appear';

const models: IModel[] = [
    {
        code: 'diagnosticRecord',
        name: 'diagnostic record',
        tableName: 'diagnostic_record',
        useRevision: true,
        attributes: {
            secret: {
                code: 'secret',
                name: 'secret',
                columnName: 'secret_value',
                type: SysFieldTypeEnum.TEXT,
            },
        },
    },
];

const createDatabase = (
    onEvent?: (event: Readonly<IDiagnosticEvent>) => Promise<void> | void,
    logger?: IDiagnosticLogger,
) =>
    new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models,
        diagnostics: { onEvent, logger },
    });

describe('database diagnostics', () => {
    test('emits query and migration lifecycle events without SQL or business data', async () => {
        const events: Readonly<IDiagnosticEvent>[] = [];
        const logger: IDiagnosticLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            error: jest.fn(),
        };
        const db = createDatabase((event) => {
            events.push(event);
        }, logger);

        try {
            await new ModelTableMigrator(db).syncAll();
            await db
                .createQueryBuilder('diagnosticRecord')
                .insert({ id: 'record-1', secret: secretValue })
                .execute();
            await db.query('diagnosticRecord').findCursorPage({
                orderBy: [{ field: 'id', direction: 'asc' }],
                limit: 10,
            });
            await expect(
                db.query('diagnosticRecord').update({
                    where: { id: 'record-1' },
                    expectedRevision: 99,
                    data: { secret: secretValue },
                }),
            ).rejects.toMatchObject({ code: 'LLI40901' });
            await db.validateStoredData();
            await expect(
                db
                    .createQueryBuilder('diagnosticRecord')
                    .select('*')
                    .where({ missingColumn: secretValue })
                    .execute(),
            ).rejects.toBeDefined();

            expect(events.map((event) => event.type)).toEqual(
                expect.arrayContaining([
                    'migration:start',
                    'migration:model:start',
                    'migration:model:success',
                    'migration:success',
                    'query:start',
                    'query:success',
                    'query:error',
                    'cursor:page:start',
                    'cursor:page:success',
                    'revision:conflict',
                    'stored-data-validation:start',
                    'stored-data-validation:success',
                ]),
            );
            expect(events.every(Object.isFrozen)).toBe(true);
            const serializedEvents = JSON.stringify(events);
            expect(serializedEvents).not.toContain(secretValue);
            for (const event of events) {
                expect(Object.keys(event)).not.toEqual(
                    expect.arrayContaining(['sql', 'bindings', 'stack', 'message', 'data']),
                );
                if (event.error) {
                    expect(Object.keys(event.error)).not.toEqual(
                        expect.arrayContaining(['stack', 'message', 'sql', 'bindings']),
                    );
                }
            }

            const errorEvent = events.find((event) => event.type === 'query:error');
            expect(errorEvent).toMatchObject({
                modelCode: 'diagnosticRecord',
                operation: 'select',
                error: { name: expect.any(String) },
            });
            if (errorEvent?.error?.code !== undefined) {
                expect(errorEvent.error.code).toEqual(expect.any(String));
            }
            expect(logger.info).toHaveBeenCalledWith(
                'migration:success',
                expect.objectContaining({ type: 'migration:success' }),
            );
            expect(logger.error).toHaveBeenCalledWith(
                'query:error',
                expect.objectContaining({ type: 'query:error' }),
            );
        } finally {
            await db.knex.destroy();
        }
    });

    test('is silent by default and supports dynamic subscription removal', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const db = createDatabase();
        const events: IDiagnosticEvent[] = [];
        const unsubscribe = db.onDiagnostic((event) => {
            events.push(event);
        });

        try {
            await new ModelTableMigrator(db).syncAll();
            unsubscribe();
            const eventCount = events.length;

            await db
                .createQueryBuilder('diagnosticRecord')
                .insert({ id: 'record-1', secret: secretValue })
                .execute();

            expect(events).toHaveLength(eventCount);
            expect(consoleError).not.toHaveBeenCalled();
        } finally {
            consoleError.mockRestore();
            await db.knex.destroy();
        }
    });

    test('emits sanitized model and migration errors', async () => {
        const events: Readonly<IDiagnosticEvent>[] = [];
        const db = createDatabase((event) => {
            events.push(event);
        });
        jest.spyOn(db.fieldTypeManager, 'get').mockImplementation(() => {
            throw new Error(secretValue);
        });

        try {
            await expect(new ModelTableMigrator(db).syncAll()).rejects.toThrow(secretValue);
            expect(events.map((event) => event.type)).toEqual(
                expect.arrayContaining(['migration:model:error', 'migration:error']),
            );
            expect(JSON.stringify(events)).not.toContain(secretValue);
            const errors = events.filter((event) => event.error).map((event) => event.error);
            expect(errors.length).toBeGreaterThanOrEqual(2);
            expect(errors.every((error) => Object.isFrozen(error))).toBe(true);
        } finally {
            await db.knex.destroy();
        }
    });

    test('does not let listener or logger failures change database behavior', async () => {
        const db = createDatabase(
            async () => Promise.reject(new Error('listener failure')),
            {
                debug: () => {
                    throw new Error('logger failure');
                },
                info: async () => Promise.reject(new Error('logger failure')),
            },
        );

        try {
            await expect(new ModelTableMigrator(db).syncAll()).resolves.toBe(true);
            await expect(
                db
                    .createQueryBuilder('diagnosticRecord')
                    .insert({ id: 'record-1', secret: secretValue })
                    .execute(),
            ).resolves.toBeDefined();
        } finally {
            await db.knex.destroy();
        }
    });
});
