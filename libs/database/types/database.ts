import { Knex } from 'knex';
import type { IModelStore } from './model-store';
import type { IModel } from './model';
import type { Encrypt } from '../utils';
import type { Diagnostics } from '../diagnostics';
import type { IDiagnosticListener, IDiagnosticsConfig } from './diagnostics';
import type { ReadSnapshot } from '../read-snapshot';

export interface IEncryptConfig {
    /** Default 32-byte key used by AES encrypted fields. */
    key?: string | Buffer;
    /** @deprecated Only required while reading legacy aes-256-cbc values. */
    iv?: string | Buffer;
    /** @deprecated Only used to verify explicitly configured legacy SHA-256 fields. */
    salt?: string;
}

export interface IQueryConfig {
    /** Maximum number of rows accepted by a single `pageSize`. Defaults to 1000. */
    maxPageSize?: number;
    /** Maximum number of rows accepted by a single `limit`. Defaults to 1000. */
    maxLimit?: number;
    /** Maximum accepted offset, including offsets calculated from page/pageSize. Defaults to 100000. */
    maxOffset?: number;
    /** Maximum number of relation IDs used by each populate query. Defaults to 500. */
    populateBatchSize?: number;
}

export type IValidationMode = 'coerce' | 'strict';
export type IDatetimeFormat = 'legacy' | 'iso-utc-ms';

export interface IValidationConfig {
    /** Keep historical coercion by default; strict rejects type coercion. */
    mode?: IValidationMode;
    /** Reject keys that are not model attributes or declared child payloads. */
    rejectUnknownFields?: boolean;
    /** Controls DATETIME validation and output. Defaults to iso-utc-ms in strict mode, otherwise legacy. */
    datetimeFormat?: IDatetimeFormat;
}

export interface IReadSnapshotConfig {
    /** Maximum concurrently open snapshots. Defaults to 8. */
    maxActive?: number;
    /** Maximum lifetime accepted by openReadSnapshot. Defaults to 300000. */
    maxLifetimeMs?: number;
}

export interface IReadSnapshotOptions {
    maxLifetimeMs?: number;
}

export interface IReadSnapshotStats {
    activeCount: number;
    oldestAgeMs: number;
    autoClosedCount: number;
}

export interface ISqliteConfig {
    journalMode?: 'wal' | 'delete';
    foreignKeys?: boolean;
    busyTimeoutMs?: number;
    synchronous?: 'off' | 'normal' | 'full' | 'extra';
}

export interface ISqliteRuntimeState {
    journalMode: string;
    foreignKeys: boolean;
    busyTimeoutMs: number;
    synchronous: 'off' | 'normal' | 'full' | 'extra' | string;
    queryOnly: boolean;
}

export interface IDatabaseBackupOptions {
    destination: string;
    overwrite?: boolean;
    verify?: boolean;
}

export interface IDatabaseBackupResult {
    destination: string;
    size: number;
    completedAt: string;
    verified: boolean;
}

export interface IIntegrityCheckOptions {
    quick?: boolean;
}

export interface IIntegrityCheckResult {
    ok: boolean;
    messages: string[];
}

export interface IStoredDataValidationOptions {
    models?: string[];
    batchSize?: number;
    stopAfterErrors?: number;
}

export interface IStoredDataValidationIssue {
    modelCode: string;
    fieldCode: string;
    recordId: string;
    reason: string;
}

export interface IStoredDataValidationReport {
    ok: boolean;
    checkedRows: number;
    errorCount: number;
    truncated: boolean;
    issues: IStoredDataValidationIssue[];
}

export interface IDatabaseConfig {
    // 应用根目录
    appRoot?: string;
    // 类型生成目录
    typeOutDir?: string;
    // 是否根据模型生成类型文件
    canGenerateType?: boolean;
    connection: Knex.Config;
    modelConfig?: {
        userModelCode: string;
        userModelDisplayCode: string;
    };
    models: IModel[];
    encrypt?: IEncryptConfig;
    query?: IQueryConfig;
    validation?: IValidationConfig;
    readSnapshots?: IReadSnapshotConfig;
    sqlite?: ISqliteConfig;
    diagnostics?: IDiagnosticsConfig;
}

export interface IDatabase {
    modelStore: IModelStore;
    config: IDatabaseConfig;
    encrypt: Encrypt;
    diagnostics: Diagnostics;
    onDiagnostic(listener: IDiagnosticListener): () => void;
    close(): Promise<void>;
    openReadSnapshot(options?: IReadSnapshotOptions): Promise<ReadSnapshot>;
    getReadSnapshotStats(): Readonly<IReadSnapshotStats>;
    getSqliteRuntimeState(): Promise<Readonly<ISqliteRuntimeState>>;
    backup(options: IDatabaseBackupOptions): Promise<IDatabaseBackupResult>;
    integrityCheck(options?: IIntegrityCheckOptions): Promise<IIntegrityCheckResult>;
    validateStoredData(
        options?: IStoredDataValidationOptions,
    ): Promise<IStoredDataValidationReport>;
}
