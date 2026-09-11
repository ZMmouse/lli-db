import type {
    IDatabaseConfig,
    IDiagnosticEvent,
    IQueryConfig,
    ITransactionContext,
} from '../../libs';
import { Database, ModelTableMigrator } from '../../libs';

interface User {
    id: string;
    name: string;
    revision: number;
}

declare const db: Database;

const queryConfig: IQueryConfig = { populateBatchSize: 500, maxPageSize: 1000 };
void queryConfig;
// @ts-expect-error query limits must be numeric.
const invalidQueryConfig: IQueryConfig = { maxLimit: '1000' };
void invalidQueryConfig;

const minletConfig: IDatabaseConfig = {
    connection: {
        client: 'better-sqlite3',
        connection: { filename: 'app.sqlite3' },
    },
    models: [],
    validation: {
        mode: 'strict',
        rejectUnknownFields: true,
        datetimeFormat: 'iso-utc-ms',
    },
    sqlite: {
        journalMode: 'wal',
        foreignKeys: true,
        busyTimeoutMs: 5_000,
        synchronous: 'normal',
    },
    readSnapshots: { maxActive: 4, maxLifetimeMs: 300_000 },
};
void minletConfig;

async function verifyPublicTypes() {
    const unsubscribe = db.onDiagnostic((event: Readonly<IDiagnosticEvent>) => {
        event.type.toUpperCase();
        // @ts-expect-error diagnostic events intentionally do not expose SQL.
        void event.sql;
    });
    unsubscribe();

    const user = await db.query<User>('user').findOne({ where: { id: 'user-1' } });

    // @ts-expect-error findOne can return null and must be narrowed before use.
    user.name.toUpperCase();
    if (user) {
        user.name.toUpperCase();
    }

    const transactionResult = await db.transaction(
        async ({ trx, onCommit, onRollback }: ITransactionContext) => {
            await trx('users').where({ id: 'user-1' }).update({ name: 'updated' });
            onCommit(async () => undefined);
            onRollback(() => undefined);

            // @ts-expect-error transaction hooks do not receive arbitrary arguments.
            onCommit((value: string) => Promise.resolve(value));
            return 42 as const;
        },
    );
    const exactResult: 42 = transactionResult;
    void exactResult;

    await db.query<User>('user').updateMany({
        allowAll: true,
        data: { name: 'updated' },
    });

    const cursorPage = await db.query<User>('user').findCursorPage({
        orderBy: [{ field: 'name', direction: 'asc' }],
        after: { name: 'Ada', id: 'user-1' },
        limit: 20,
    });
    void cursorPage.nextPosition?.id;

    await db.query<User>('user').update({
        where: { id: 'user-1' },
        expectedRevision: 2,
        data: { name: 'updated' },
    });

    const snapshot = await db.openReadSnapshot({ maxLifetimeMs: 10_000 });
    await snapshot.query<User>('user').findMany();
    await snapshot.close();

    const backup = await db.backup({ destination: 'backup.sqlite3', verify: true });
    backup.completedAt.toUpperCase();
    const integrity = await db.integrityCheck({ quick: true });
    integrity.messages.map((message) => message.toUpperCase());
    const validation = await db.validateStoredData({ batchSize: 100 });
    validation.issues.map((issue) => issue.fieldCode);
    await new ModelTableMigrator(db).syncAll({ validateStoredData: true });

    // @ts-expect-error revision must be numeric.
    await db.query<User>('user').update({ expectedRevision: '2', data: { name: 'invalid' } });
    // @ts-expect-error cursor directions are restricted to asc/desc.
    await db.query<User>('user').findCursorPage({ orderBy: [{ field: 'id', direction: 'up' }] });

    const manualTransaction = await db.transaction();
    manualTransaction.get();
    await manualTransaction.rollback();

    // @ts-expect-error select must use the supported string/object/array contract.
    await db.query<User>('user').findMany({ select: 123 });
    // @ts-expect-error populate must be a relation name, list, or populate map.
    await db.query<User>('user').findMany({ populate: 123 });
    // @ts-expect-error write data must be an object or an array of objects.
    await db.query<User>('user').create({ data: 'invalid' });
    // @ts-expect-error pagination values must be numeric.
    await db.query<User>('user').findMany({ page: '1' });
}

void verifyPublicTypes;
