import type { Knex } from 'knex';

export type ITransactionHook = () => Promise<void> | void;

export interface ITransactionContext {
    trx: Knex.Transaction;
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    onCommit: (callback: ITransactionHook) => void;
    onRollback: (callback: ITransactionHook) => void;
}

export type ITransactionCallback<TResult = unknown> = (
    context: ITransactionContext,
) => Promise<TResult> | TResult;

export interface ITransactionObject {
    commit: () => Promise<void>;
    rollback: () => Promise<void>;
    get: () => Knex.Transaction;
}

export interface ITransactionStore {
    trx: Knex.Transaction | null;
    commitCallbacks: ITransactionHook[];
    rollbackCallbacks: ITransactionHook[];
}
