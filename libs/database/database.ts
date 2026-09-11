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
import { Diagnostics, toDiagnosticError } from './diagnostics';
import type { IDiagnosticListener } from './types/diagnostics';
import { getDatabaseDriverCompatibility, validateDatabaseClient } from './driver-compatibility';
import { ReadSnapshot } from './read-snapshot';
import type { IReadSnapshotOptions } from './types/database';
import type {
    IDatabaseBackupOptions,
    IDatabaseBackupResult,
    IIntegrityCheckOptions,
    IIntegrityCheckResult,
} from './types/database';
import { randomUUID } from 'node:crypto';
import { access, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import knex from 'knex';
import { validateStoredData } from './stored-data-validator';
import type {
    IStoredDataValidationOptions,
    IStoredDataValidationReport,
} from './types/database';

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
    private readonly readSnapshots = new Set<ReadSnapshot>();

    private readonly _lifecycleProvider: ILifecycleProvider;
    constructor(config: IDatabaseConfig) {
        validateModels(config.models ?? []);
        validateQueryConfig(config.query);
        validateDatabaseClient(config.connection.client);
        this.validateReadSnapshotConfig(config);
        this._config = Object.freeze({
            ...config,
            query: config.query ? Object.freeze({ ...config.query }) : undefined,
            validation: config.validation
                ? Object.freeze({ ...config.validation })
                : undefined,
            readSnapshots: config.readSnapshots
                ? Object.freeze({ ...config.readSnapshots })
                : undefined,
            sqlite: config.sqlite ? Object.freeze({ ...config.sqlite }) : undefined,
            diagnostics: config.diagnostics
                ? Object.freeze({ ...config.diagnostics })
                : undefined,
        });
        this._diagnostics = new Diagnostics(config.diagnostics);
        this._knex = createKnex(config.connection, config.sqlite);
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

    private validateReadSnapshotConfig(config: IDatabaseConfig) {
        const snapshotConfig = config.readSnapshots;
        if (!snapshotConfig) return;
        if (String(config.connection.client).toLowerCase() !== 'better-sqlite3') {
            throw new LliDbError(
                'readSnapshots require the better-sqlite3 client',
                'LLI400',
            );
        }
        for (const [name, value] of Object.entries(snapshotConfig)) {
            if (!Number.isSafeInteger(value) || value < 1) {
                throw new LliDbError(`readSnapshots.${name} must be a positive integer`, 'LLI400');
            }
        }
    }

    private closePromise?: Promise<void>;
    private closed = false;

    assertOpen() {
        if (this.closed) {
            throw new LliDbError('Database is closed', 'LLI41000');
        }
    }

    close() {
        if (!this.closePromise) {
            this.closed = true;
            this.closePromise = (async () => {
                const results = await Promise.allSettled(
                    Array.from(this.readSnapshots, (snapshot) => snapshot.close()),
                );
                await this._knex.destroy();
                const failure = results.find(
                    (result): result is PromiseRejectedResult => result.status === 'rejected',
                );
                if (failure) throw failure.reason;
            })();
        }
        return this.closePromise;
    }

    async openReadSnapshot(options: IReadSnapshotOptions = {}) {
        this.assertOpen();
        if (String(this._config.connection.client).toLowerCase() !== 'better-sqlite3') {
            throw new LliDbError('Read snapshots require the better-sqlite3 client', 'LLI400');
        }
        const connection = this._config.connection.connection;
        const filename =
            connection && typeof connection === 'object' && 'filename' in connection
                ? String(connection.filename)
                : undefined;
        if (!filename || filename === ':memory:') {
            throw new LliDbError('Read snapshots require a file-backed SQLite database', 'LLI400');
        }
        const maxActive = this._config.readSnapshots?.maxActive ?? 8;
        if (!Number.isSafeInteger(maxActive) || maxActive < 1) {
            throw new LliDbError('readSnapshots.maxActive must be a positive integer', 'LLI400');
        }
        if (this.readSnapshots.size >= maxActive) {
            this._diagnostics.emit({
                type: 'snapshot:limit',
                operation: 'openReadSnapshot',
                snapshotCount: this.readSnapshots.size,
            });
            throw new LliDbError('Read snapshot limit reached', 'LLI42901');
        }
        const configuredLifetime = this._config.readSnapshots?.maxLifetimeMs ?? 300_000;
        const requestedLifetime = options.maxLifetimeMs ?? configuredLifetime;
        if (
            !Number.isSafeInteger(requestedLifetime) ||
            requestedLifetime < 1 ||
            requestedLifetime > configuredLifetime
        ) {
            throw new LliDbError('Invalid read snapshot lifetime', 'LLI400');
        }
        const transaction = await this._knex.transaction();
        try {
            await transaction.raw('SELECT name FROM sqlite_master LIMIT 1');
        } catch (error) {
            if (!transaction.isCompleted()) await transaction.rollback().catch(() => undefined);
            throw error;
        }
        const snapshot = new ReadSnapshot(
            this,
            transaction,
            requestedLifetime,
            () => this.readSnapshots.delete(snapshot),
        );
        this.readSnapshots.add(snapshot);
        this._diagnostics.emit({
            type: 'snapshot:open',
            operation: 'openReadSnapshot',
            snapshotCount: this.readSnapshots.size,
        });
        return snapshot;
    }

    private assertSqlite(operation: string) {
        if (getDatabaseDriverCompatibility(this._config.connection.client).family !== 'sqlite') {
            throw new LliDbError(`${operation} is currently supported only for SQLite`, 'LLI400');
        }
    }

    async integrityCheck(options: IIntegrityCheckOptions = {}): Promise<IIntegrityCheckResult> {
        const startedAt = Date.now();
        this.assertOpen();
        this.assertSqlite('Integrity check');
        this._diagnostics.emit({ type: 'integrity-check:start', operation: 'integrityCheck' });
        try {
            const pragma = options.quick ? 'quick_check' : 'integrity_check';
            const rows = (await this._knex.raw(`PRAGMA ${pragma}`)) as Array<Record<string, unknown>>;
            const messages = rows.map((row) => String(Object.values(row)[0]));
            const result = { ok: messages.length === 1 && messages[0].toLowerCase() === 'ok', messages };
            this._diagnostics.emit({
                type: result.ok ? 'integrity-check:success' : 'integrity-check:error',
                operation: 'integrityCheck',
                durationMs: Date.now() - startedAt,
            });
            return result;
        } catch (error) {
            this._diagnostics.emit({
                type: 'integrity-check:error',
                operation: 'integrityCheck',
                durationMs: Date.now() - startedAt,
                error: toDiagnosticError(error),
            });
            throw error;
        }
    }

    async backup(options: IDatabaseBackupOptions): Promise<IDatabaseBackupResult> {
        const startedAt = Date.now();
        this.assertOpen();
        this.assertSqlite('Backup');
        this._diagnostics.emit({ type: 'backup:start', operation: 'backup' });
        let temporary: string | undefined;
        let verification: IIntegrityCheckResult | undefined;
        let connection: any;
        try {
            if (!options || typeof options.destination !== 'string' || !options.destination.trim()) {
                throw new LliDbError('backup destination must be a non-empty path', 'LLI400');
            }
            const destination = resolve(options.destination);
            const directory = dirname(destination);
            await mkdir(directory, { recursive: true });
            if (!options.overwrite) {
                try {
                    await access(destination);
                    throw new LliDbError('backup destination already exists', 'LLI400');
                } catch (error) {
                    if (error instanceof LliDbError) throw error;
                    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                }
            }
            temporary = `${destination}.tmp-${randomUUID()}`;
            connection = await this._knex.client.acquireConnection();
            if (typeof connection.backup !== 'function') {
                throw new LliDbError('The active SQLite driver does not provide online backup', 'LLI400');
            }
            await connection.backup(temporary);
            if (options.verify) {
                const verifier = knex({
                    client: 'better-sqlite3',
                    connection: { filename: temporary },
                    useNullAsDefault: true,
                    pool: { min: 1, max: 1 },
                });
                try {
                    const rows = (await verifier.raw('PRAGMA integrity_check')) as Array<
                        Record<string, unknown>
                    >;
                    const messages = rows.map((row) => String(Object.values(row)[0]));
                    verification = {
                        ok: messages.length === 1 && messages[0].toLowerCase() === 'ok',
                        messages,
                    };
                } finally {
                    await verifier.destroy();
                }
                if (!verification.ok) {
                    throw new LliDbError('Backup integrity verification failed', 'LLI50020');
                }
            }
            if (options.overwrite) await rm(destination, { force: true });
            await rename(temporary, destination);
            const result = {
                destination,
                size: (await stat(destination)).size,
                completedAt: new Date().toISOString(),
                verified: verification?.ok ?? false,
            };
            this._diagnostics.emit({
                type: 'backup:success',
                operation: 'backup',
                durationMs: Date.now() - startedAt,
                size: result.size,
            });
            return result;
        } catch (error) {
            if (temporary) await rm(temporary, { force: true }).catch(() => undefined);
            this._diagnostics.emit({
                type: 'backup:error',
                operation: 'backup',
                durationMs: Date.now() - startedAt,
                error: toDiagnosticError(error),
            });
            throw error instanceof LliDbError
                ? error
                : new LliDbError('SQLite backup failed', 'LLI50020');
        } finally {
            if (connection) await this._knex.client.releaseConnection(connection);
        }
    }

    async validateStoredData(
        options: IStoredDataValidationOptions = {},
    ): Promise<IStoredDataValidationReport> {
        this.assertOpen();
        const startedAt = Date.now();
        this._diagnostics.emit({
            type: 'stored-data-validation:start',
            operation: 'validateStoredData',
        });
        try {
            const report = await validateStoredData(this, options);
            this._diagnostics.emit({
                type: report.ok
                    ? 'stored-data-validation:success'
                    : 'stored-data-validation:error',
                operation: 'validateStoredData',
                durationMs: Date.now() - startedAt,
                checkedRows: report.checkedRows,
                errorCount: report.errorCount,
            });
            return report;
        } catch (error) {
            this._diagnostics.emit({
                type: 'stored-data-validation:error',
                operation: 'validateStoredData',
                durationMs: Date.now() - startedAt,
                error: toDiagnosticError(error),
            });
            throw error;
        }
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
        this.assertOpen();
        return this.entityManager.createQueryBuilder(code);
    }

    get knex() {
        return this._knex;
    }

    get modelStore() {
        return this._modelStore;
    }

    query<T = IAnyObject>(code: string) {
        this.assertOpen();
        if (!this._modelStore.has(code)) {
            LliDbError.throwModelNotFound(code);
        }
        return this.entityManager.getRepository<T>(code);
    }

    getConnection(tableName?: string) {
        this.assertOpen();
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
        this.assertOpen();
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
