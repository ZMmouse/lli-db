import { AsyncLocalStorage } from 'node:async_hooks';
import { Knex } from 'knex';
import type { ITransactionHook, ITransactionStore } from './types/transaction-ctx';

const storage = new AsyncLocalStorage<ITransactionStore>();

const runCallbacks = async (callbacks: ITransactionHook[]) => {
    let hasError = false;
    let firstError: unknown;

    for (const callback of callbacks) {
        try {
            await callback();
        } catch (error) {
            if (!hasError) {
                hasError = true;
                firstError = error;
            }
        }
    }

    if (hasError) {
        throw firstError;
    }
};

/**
 * Adapted from Strapi Community Edition's transaction context implementation.
 * Copyright (c) 2015-present Strapi Solutions SAS, licensed under MIT.
 * See the repository NOTICE file for source and license details.
 */

export const transactionCtx = {
    async run<TResult>(
        trx: Knex.Transaction,
        cb: () => Promise<TResult> | TResult,
    ): Promise<TResult> {
        const store = storage.getStore();

        return storage.run(
            {
                trx,
                commitCallbacks: store?.commitCallbacks || [],
                rollbackCallbacks: store?.rollbackCallbacks || [],
            },
            cb,
        );
    },

    get() {
        const store = storage.getStore();
        return store?.trx;
    },

    async commit(trx: Knex.Transaction) {
        const store = storage.getStore();
        if (store?.trx) {
            store.trx = null;
        }

        await trx.commit();

        if (!store?.commitCallbacks.length) {
            return;
        }

        const commitCallbacks = [...store.commitCallbacks];
        store.commitCallbacks = [];
        await runCallbacks(commitCallbacks);
    },

    async rollback(trx: Knex.Transaction) {
        const store = storage.getStore();
        if (store?.trx) {
            store.trx = null;
        }

        await trx.rollback();

        if (!store?.rollbackCallbacks.length) {
            return;
        }

        const rollbackCallbacks = [...store.rollbackCallbacks];
        store.rollbackCallbacks = [];
        await runCallbacks(rollbackCallbacks);
    },

    onCommit(cb: ITransactionHook) {
        const store = storage.getStore();
        if (store?.commitCallbacks) {
            store.commitCallbacks.push(cb);
        }
    },

    onRollback(cb: ITransactionHook) {
        const store = storage.getStore();
        if (store?.rollbackCallbacks) {
            store.rollbackCallbacks.push(cb);
        }
    },
};
