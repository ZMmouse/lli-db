import { Knex } from 'knex';
import type { IDatabase } from './types/database';
import type { IDatabaseConfig } from './types/database';
import { createKnex } from './knex';
import { ModelStore } from './model-mgr/model-store';
import { createModelStore, validateModels } from './model-mgr';
import { EntityManager } from './entity-manager';
import { createLifecycleProvider, ILifecycleProvider } from './lifecycles';
import { transactionCtx } from './transaction-ctx';
import type { ITransactionCallback, ITransactionObject } from './types/transaction-ctx';
import type { ISysModelAttrMgr } from './model-mgr/types';
import { createSysModelAttrMgr } from './model-mgr/sys-model-attr-mgr';
import { IAnyObject } from './types/any-object';
import { LliDbError } from './error/lli-db-error';
import { FieldTypeManager } from './field-type-manager';
import { Encrypt } from './utils';
import { MiddlewareManager } from './middleware-manager';
import { validateQueryConfig } from './query/helpers/limits';
import { Diagnostics } from './diagnostics';
import type { IDiagnosticListener } from './types/diagnostics';
import { validateDatabaseClient } from './driver-compatibility';

export class Database implements IDatabase {
    private _config: IDatabaseConfig;
    private readonly _knex: Knex;
    private readonly _modelStore: ModelStore;
    private readonly _entityManager: EntityManager;
    private readonly _sysModelAttrMgr: ISysModelAttrMgr;
    private readonly _fieldTypeManager: FieldTypeManager;
    private readonly _encrypt: Encrypt;
    private readonly _middlewareManager: MiddlewareManager;
    private readonly _diagnostics: Diagnostics;

    private readonly _lifecycleProvider: ILifecycleProvider;
    constructor(config: IDatabaseConfig) {
        validateModels(config.models ?? []);
        validateQueryConfig(config.query);
        validateDatabaseClient(config.connection.client);
        this._config = Object.freeze({
            ...config,
            query: config.query ? Object.freeze({ ...config.query }) : undefined,
            diagnostics: config.diagnostics
                ? Object.freeze({ ...config.diagnostics })
                : undefined,
        });
        this._diagnostics = new Diagnostics(config.diagnostics);
        this._knex = createKnex(config.connection);
        this._sysModelAttrMgr = createSysModelAttrMgr(this, config.modelConfig ?? {});
        this._middlewareManager = new MiddlewareManager(this);
        this._modelStore = createModelStore(this, config.models ?? []);
        this._lifecycleProvider = createLifecycleProvider(this);
        this._entityManager = new EntityManager(this);
        this._fieldTypeManager = new FieldTypeManager(this);
        this._encrypt = new Encrypt(this);
    }

    get config() {
        return this._config;
    }

    get encrypt() {
        return this._encrypt;
    }

    get entityManager() {
        return this._entityManager;
    }

    get sysModelAttrMgr() {
        return this._sysModelAttrMgr;
    }

    get lifecycleProvider() {
        return this._lifecycleProvider;
    }

    get fieldTypeManager() {
        return this._fieldTypeManager;
    }

    get middlewareManager() {
        return this._middlewareManager;
    }

    get diagnostics() {
        return this._diagnostics;
    }

    onDiagnostic(listener: IDiagnosticListener) {
        return this._diagnostics.subscribe(listener);
    }

    createQueryBuilder(code: string) {
        return this.entityManager.createQueryBuilder(code);
    }

    get knex() {
        return this._knex;
    }

    get modelStore() {
        return this._modelStore;
    }

    query<T = IAnyObject>(code: string) {
        if (!this._modelStore.has(code)) {
            LliDbError.throwModelNotFound(code);
        }
        return this.entityManager.getRepository<T>(code);
    }

    getConnection(tableName?: string) {
        if (tableName) {
            return this._knex(tableName);
        }
        return this._knex();
    }

    async transaction(): Promise<ITransactionObject>;
    async transaction<TResult>(cb: ITransactionCallback<TResult>): Promise<TResult>;
    async transaction<TResult>(
        cb?: ITransactionCallback<TResult>,
    ): Promise<TResult | ITransactionObject> {
        const noTransaction = !transactionCtx.get();
        const trx = noTransaction
            ? await this.knex.transaction()
            : (transactionCtx.get() as Knex.Transaction);

        async function commit() {
            if (noTransaction) {
                await transactionCtx.commit(trx);
            }
        }

        async function rollback() {
            if (noTransaction) {
                await transactionCtx.rollback(trx);
            }
        }

        if (!cb) {
            return { commit, rollback, get: () => trx };
        }

        return transactionCtx.run(trx, async () => {
            let res: TResult;
            try {
                res = await cb({
                    trx,
                    commit,
                    rollback,
                    onCommit: transactionCtx.onCommit,
                    onRollback: transactionCtx.onRollback,
                });
            } catch (e) {
                try {
                    await rollback();
                } catch (rollbackError) {
                    if (rollbackError instanceof Error && !(<any>rollbackError).cause) {
                        Object.defineProperty(rollbackError, 'cause', { value: e });
                    }
                    throw rollbackError;
                }
                throw e;
            }

            // Commit callbacks run after the database has committed. Their failures reject
            // this promise, but must never trigger a rollback of an already committed trx.
            await commit();
            return res;
        });
    }
}
