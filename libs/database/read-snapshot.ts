import type { Knex } from 'knex';
import type { Database } from './database';
import { toDiagnosticError } from './diagnostics';
import { LliDbError } from './error/lli-db-error';
import type { ICursorPageResult } from './types/i-result';
import type { ICursorPageParams, IParams } from './types/query';
import { transactionCtx } from './transaction-ctx';

interface IReadSnapshotState {
    database: Database;
    transaction: Knex.Transaction;
    closed: boolean;
    activeReads: number;
    drainWaiters: Array<() => void>;
    closePromise?: Promise<void>;
    openedAt: number;
    expiresAt: number;
    timer: ReturnType<typeof setTimeout>;
    onClose: (reason: 'close' | 'expire') => void;
}

const states = new WeakMap<ReadSnapshot, IReadSnapshotState>();

const getState = (snapshot: ReadSnapshot) => {
    const state = states.get(snapshot);
    if (!state) throw new LliDbError('Invalid read snapshot', 'LLI41001');
    return state;
};

const assertOpen = (snapshot: ReadSnapshot) => {
    const state = getState(snapshot);
    if (state.closed || Date.now() >= state.expiresAt) {
        throw new LliDbError('Read snapshot is closed or expired', 'LLI41001');
    }
    return state;
};

const runRead = async <T>(snapshot: ReadSnapshot, callback: (database: Database) => Promise<T>) => {
    const state = assertOpen(snapshot);
    state.activeReads += 1;
    try {
        return await transactionCtx.run(state.transaction, () => callback(state.database), {
            readOnly: true,
        });
    } finally {
        state.activeReads -= 1;
        if (state.activeReads === 0) {
            for (const resolve of state.drainWaiters.splice(0)) resolve();
        }
    }
};

const closeSnapshot = (snapshot: ReadSnapshot, reason: 'close' | 'expire') => {
    const state = getState(snapshot);
    if (state.closePromise) return state.closePromise;
    state.closed = true;
    clearTimeout(state.timer);
    let closePromise!: Promise<void>;
    closePromise = (async () => {
        if (state.activeReads > 0) {
            await new Promise<void>((resolve) => state.drainWaiters.push(resolve));
        }
        try {
            if (!state.transaction.isCompleted()) {
                await state.transaction.raw('PRAGMA query_only = OFF').catch(() => undefined);
                await state.transaction.rollback();
            }
            state.onClose(reason);
            state.database.diagnostics.emit({
                type: reason === 'expire' ? 'snapshot:expire' : 'snapshot:close',
                operation: reason,
            });
        } catch (error) {
            if (state.closePromise === closePromise) state.closePromise = undefined;
            state.database.diagnostics.emit({
                type: 'snapshot:error',
                operation: reason,
                error: toDiagnosticError(error),
            });
            throw error;
        }
    })();
    state.closePromise = closePromise;
    return closePromise;
};

export class ReadSnapshotRepository<T> {
    constructor(
        private readonly snapshot: ReadSnapshot,
        private readonly code: string,
    ) {}

    findOne(params: IParams = {}): Promise<T | null> {
        return runRead(this.snapshot, (database) => database.query<T>(this.code).findOne(params));
    }

    findMany(params: IParams = {}): Promise<T[]> {
        return runRead(this.snapshot, (database) => database.query<T>(this.code).findMany(params));
    }

    count(params: IParams = {}, fieldCode = 'id'): Promise<number> {
        return runRead(this.snapshot, (database) =>
            database.query<T>(this.code).count(params, fieldCode),
        );
    }

    findCursorPage(params: ICursorPageParams): Promise<ICursorPageResult<T>> {
        return runRead(this.snapshot, (database) =>
            database.query<T>(this.code).findCursorPage(params),
        );
    }
}

export class ReadSnapshot {
    constructor(
        database: Database,
        transaction: Knex.Transaction,
        maxLifetimeMs: number,
        onClose: (reason: 'close' | 'expire') => void,
    ) {
        const openedAt = Date.now();
        const state = {
            database,
            transaction,
            closed: false,
            activeReads: 0,
            drainWaiters: [],
            openedAt,
            expiresAt: openedAt + maxLifetimeMs,
            timer: undefined as unknown as ReturnType<typeof setTimeout>,
            onClose,
        };
        state.timer = setTimeout(() => {
            void closeSnapshot(this, 'expire').catch(() => undefined);
        }, maxLifetimeMs);
        state.timer.unref?.();
        states.set(this, state);
    }

    get openedAt() {
        return getState(this).openedAt;
    }

    query<T = Record<string, unknown>>(code: string) {
        assertOpen(this);
        return new ReadSnapshotRepository<T>(this, code);
    }

    close() {
        return closeSnapshot(this, 'close');
    }
}
