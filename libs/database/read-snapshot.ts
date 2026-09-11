import type { Knex } from 'knex';
import type { Database } from './database';
import { LliDbError } from './error/lli-db-error';
import type { ICursorPageParams, IParams } from './types/query';
import type { ICursorPageResult } from './types/i-result';
import { transactionCtx } from './transaction-ctx';

export class ReadSnapshotRepository<T> {
    constructor(
        private readonly snapshot: ReadSnapshot,
        private readonly code: string,
    ) {}

    findOne(params: IParams = {}): Promise<T | null> {
        return this.snapshot.run(() => this.snapshot.database.query<T>(this.code).findOne(params));
    }

    findMany(params: IParams = {}): Promise<T[]> {
        return this.snapshot.run(() => this.snapshot.database.query<T>(this.code).findMany(params));
    }

    count(params: IParams = {}, fieldCode = 'id'): Promise<number> {
        return this.snapshot.run(() =>
            this.snapshot.database.query<T>(this.code).count(params, fieldCode),
        );
    }

    findCursorPage(params: ICursorPageParams): Promise<ICursorPageResult<T>> {
        return this.snapshot.run(() =>
            this.snapshot.database.query<T>(this.code).findCursorPage(params),
        );
    }
}

export class ReadSnapshot {
    private closed = false;
    private readonly expiresAt: number;
    private readonly timer: ReturnType<typeof setTimeout>;

    constructor(
        readonly database: Database,
        private readonly transaction: Knex.Transaction,
        maxLifetimeMs: number,
        private readonly onClose: () => void,
    ) {
        this.expiresAt = Date.now() + maxLifetimeMs;
        this.timer = setTimeout(() => {
            void this.close('expire').catch(() => undefined);
        }, maxLifetimeMs);
        this.timer.unref?.();
    }

    query<T = Record<string, unknown>>(code: string) {
        this.assertOpen();
        return new ReadSnapshotRepository<T>(this, code);
    }

    async run<T>(callback: () => Promise<T>): Promise<T> {
        this.assertOpen();
        return transactionCtx.run(this.transaction, callback);
    }

    private assertOpen() {
        if (this.closed || Date.now() >= this.expiresAt) {
            throw new LliDbError('Read snapshot is closed or expired', 'LLI41001');
        }
    }

    async close(reason: 'close' | 'expire' = 'close') {
        if (this.closed) return;
        this.closed = true;
        clearTimeout(this.timer);
        try {
            if (!this.transaction.isCompleted()) await this.transaction.rollback();
        } finally {
            this.onClose();
            this.database.diagnostics.emit({
                type: reason === 'expire' ? 'snapshot:expire' : 'snapshot:close',
                operation: reason,
            });
        }
    }
}
