import { Knex } from 'knex';
import type { IModelStore } from './model-store';
import type { IModel } from './model';
import type { Encrypt } from '../utils';
import type { Diagnostics } from '../diagnostics';
import type { IDiagnosticListener, IDiagnosticsConfig } from './diagnostics';

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
    diagnostics?: IDiagnosticsConfig;
}

export interface IDatabase {
    modelStore: IModelStore;
    config: IDatabaseConfig;
    encrypt: Encrypt;
    diagnostics: Diagnostics;
    onDiagnostic(listener: IDiagnosticListener): () => void;
}
