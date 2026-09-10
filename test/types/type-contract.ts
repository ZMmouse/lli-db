import type { IDiagnosticEvent, IQueryConfig, ITransactionContext } from '../../libs';
import { Database } from '../../libs';

interface User {
    id: string;
    name: string;
}

declare const db: Database;

const queryConfig: IQueryConfig = { populateBatchSize: 500, maxPageSize: 1000 };
void queryConfig;
// @ts-expect-error query limits must be numeric.
const invalidQueryConfig: IQueryConfig = { maxLimit: '1000' };
void invalidQueryConfig;

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
