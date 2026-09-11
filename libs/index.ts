import type {
    IDatabaseConfig,
    IDatetimeFormat,
    IEncryptConfig,
    IQueryConfig,
    IValidationConfig,
    IValidationMode,
    IReadSnapshotConfig,
    IReadSnapshotOptions,
    IReadSnapshotStats,
    ISqliteConfig,
    ISqliteRuntimeState,
    IDatabaseBackupOptions,
    IDatabaseBackupResult,
    IIntegrityCheckOptions,
    IIntegrityCheckResult,
    IStoredDataValidationIssue,
    IStoredDataValidationOptions,
    IStoredDataValidationReport,
} from './database/types/database';
import type { EntityRepository } from './database/entity-manager/entity-repository';
import type { EntityManager } from './database/entity-manager';
import type { QueryBuilder } from './database/query';
import { Database } from './database/database';
export type {
    IOrderBy,
    IParams,
    IPopulate,
    IPopulateObject,
    ISelect,
    ISelectObject,
    IUpdateManyParams,
    IWhere,
    ICursorOrder,
    ICursorPageParams,
    IOptimisticMutationOptions,
    IMutationParams,
} from './database/types/query';
export type { ICursorPageResult, IMutationResult } from './database/types/i-result';
export { ReadSnapshot, ReadSnapshotRepository } from './database/read-snapshot';
export type {
    ITransactionCallback,
    ITransactionContext,
    ITransactionHook,
    ITransactionObject,
} from './database/types/transaction-ctx';
export type {
    ILifecycleAction,
    ISubscribeEvent,
    ISubscriber,
    ISubscriberFn,
    ISubscriberMap,
} from './database/types/lifecycle';
export type {
    IDiagnosticError,
    IDiagnosticEvent,
    IDiagnosticEventType,
    IDiagnosticListener,
    IDiagnosticLogger,
    IDiagnosticsConfig,
} from './database/types/diagnostics';
export type { ILifecycleProvider } from './database/lifecycles';
export { validateModels } from './database/model-mgr';
export type { IValidateModelsOptions } from './database/model-mgr';
export {
    databaseDriverCompatibility,
    getDatabaseDriverCompatibility,
    validateDatabaseClient,
} from './database/driver-compatibility';
export type {
    IDatabaseDriverCompatibility,
    IDatabaseDriverFamily,
    IDatabaseDriverSupport,
} from './database/driver-compatibility';

export * from './database/error/lli-db-error';

export { SysFieldTypeEnum, SysExpansionFieldTypeEnum } from './database/enum/field-type-enum';

export type { IField, IExpansionField } from './database/types/i-field';
export type {
    IModel,
    IBaseModel,
    IAttribute,
    IEntity,
    IDecimalAttribute,
    IBaseAttribute,
    IIndex,
    IEntityIndex,
    IEntityAttribute,
    ILimitedAttribute,
    IScalarAttribute,
    ISelectAttribute,
    RelationalAttribute,
    Relation,
} from './database/types/model';

export type {
    IDatabaseConfig,
    IEncryptConfig,
    IQueryConfig,
    IDatetimeFormat,
    IValidationConfig,
    IValidationMode,
    IReadSnapshotConfig,
    IReadSnapshotOptions,
    IReadSnapshotStats,
    ISqliteConfig,
    ISqliteRuntimeState,
    IDatabaseBackupOptions,
    IDatabaseBackupResult,
    IIntegrityCheckOptions,
    IIntegrityCheckResult,
    IStoredDataValidationIssue,
    IStoredDataValidationOptions,
    IStoredDataValidationReport,
    EntityRepository,
    EntityManager,
    QueryBuilder,
};

export { Database };
export { ModelTableMigrator, buildMigrationPlan, diffModel } from './migrator';
export type {
    IMigrationOperation,
    IMigrationOperationType,
    IMigrationPlan,
    IMigrationStatus,
    IModelDiff,
    ISyncAllOptions,
} from './migrator';
