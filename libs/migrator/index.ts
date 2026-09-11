import type { Database } from '../database/database';
import type { IIndex } from '../database/model-mgr/types';
import type { Knex } from 'knex';
import { IAttribute, IDecimalAttribute, IModel } from '../database/types/model';
import {
    DBFieldTypeEnum,
    SysExpansionFieldTypeEnum,
    SysFieldTypeEnum,
} from '../database/enum/field-type-enum';
import { IField } from '../database/types/i-field';
import { v4 as uuidV4 } from 'uuid';
import { validateModels } from '../database/model-mgr';
import { generateType } from '../database/generate/generate-type';
import { toDiagnosticError } from '../database/diagnostics';
import { LliDbError } from '../database/error/lli-db-error';
import { resolve } from 'node:path';
import { validateStoredData } from '../database/stored-data-validator';
import type { IStoredDataValidationOptions } from '../database/types/database';

const modelRecord: IModel = {
    code: 'lliModelRecord',
    tableName: 'lli_model_record',
    name: '模型',
    attributes: {
        code: {
            code: 'code',
            type: SysFieldTypeEnum.TEXT,
            columnName: 'code',
            name: '编码',
            required: true,
        },
        createdAt: {
            code: 'createdAt',
            type: SysFieldTypeEnum.DATETIME,
            columnName: 'created_at',
            name: '创建时间',
            required: false,
        },
        updatedAt: {
            code: 'updatedAt',
            type: SysFieldTypeEnum.DATETIME,
            columnName: 'updated_at',
            name: '更新时间',
            required: false,
        },
        status: {
            code: 'status',
            type: SysFieldTypeEnum.TEXT,
            columnName: 'status',
            name: '迁移状态',
            required: true,
            default: 'ready',
        },
        error: {
            code: 'error',
            type: SysFieldTypeEnum.LONG_TEXT,
            columnName: 'error',
            name: '最近迁移错误',
            required: false,
        },
        models: {
            code: 'models',
            type: SysExpansionFieldTypeEnum.JSON_ARRAY,
            columnName: 'models',
            name: '模型',
            required: false,
        },
    },
};

const createIndex = (
    builder: Knex.TableBuilder,
    { name, codes, type }: IIndex,
    attributes: Record<string, IAttribute>,
) => {
    const columnNames = codes.map((code) => attributes[code].columnName);

    if (type === 'unique') {
        builder.unique(columnNames, name);
    } else {
        builder.index(columnNames, name);
    }
};

const dropIndex = (
    builder: Knex.TableBuilder,
    index: IIndex,
    attributes: Record<string, IAttribute>,
) => {
    const columnNames = index.codes.map((code) => attributes[code].columnName);

    if (index.type === 'unique') {
        builder.dropUnique(columnNames, index.name);
    } else {
        builder.dropIndex(columnNames, index.name);
    }
};

const createDBFieldRequired = (builder: Knex.ColumnBuilder, attribute: IAttribute) => {
    if (attribute.required) {
        builder.notNullable();
    } else {
        builder.nullable();
    }
};

const createDBFieldUnique = (builder: Knex.ColumnBuilder, attribute: IAttribute) => {
    if (attribute.unique) {
        builder.unique();
    }
};

const createDBFieldPrimary = (builder: Knex.ColumnBuilder, attribute: IAttribute) => {
    if (attribute.primary) {
        builder.primary();
    }
};

const createDBFieldDefault = (builder: Knex.ColumnBuilder, attribute: IAttribute) => {
    if (attribute.default !== undefined && attribute.default !== null) {
        builder.defaultTo(attribute.default);
    }
};

const createDBField = (builder: Knex.TableBuilder, field: IField, attribute: IAttribute) => {
    let columnBuilder: Knex.ColumnBuilder;
    switch (field.dbFiledType) {
        case DBFieldTypeEnum.VARCHAR:
            columnBuilder = builder
                .string(attribute.columnName, attribute.length ?? 200)
                .comment(attribute.name);
            break;
        case DBFieldTypeEnum.TEXT:
            columnBuilder = builder.text(attribute.columnName).comment(attribute.name);
            break;
        case DBFieldTypeEnum.INT:
            columnBuilder = builder
                .integer(attribute.columnName, attribute.length ?? 10)
                .comment(attribute.name);
            break;
        case DBFieldTypeEnum.FLOAT:
            columnBuilder = builder
                .decimal(
                    attribute.columnName,
                    attribute.length ?? 10,
                    (attribute as IDecimalAttribute).precise ?? 2,
                )
                .comment(attribute.name);
            break;
        case DBFieldTypeEnum.BOOLEAN:
            columnBuilder = builder.boolean(attribute.columnName).comment(attribute.name);
            break;
        case DBFieldTypeEnum.TIME:
            columnBuilder = builder.time(attribute.columnName).comment(attribute.name);
            break;
        case DBFieldTypeEnum.DATE:
            columnBuilder = builder.date(attribute.columnName).comment(attribute.name);
            break;
        case DBFieldTypeEnum.DATETIME:
            columnBuilder = builder.datetime(attribute.columnName).comment(attribute.name);
            break;
        case DBFieldTypeEnum.JSON:
            columnBuilder = builder.json(attribute.columnName).comment(attribute.name);
            break;
        default:
            throw new Error(`Unsupported field type: ${field.dbFiledType}`);
    }
    createDBFieldDefault(columnBuilder, attribute);
    createDBFieldRequired(columnBuilder, attribute);
    createDBFieldUnique(columnBuilder, attribute);
    createDBFieldPrimary(columnBuilder, attribute);
};

const getColumnBuilder = (builder: Knex.TableBuilder, field: IField, attribute: IAttribute) => {
    let columnBuilder: Knex.ColumnBuilder;
    switch (field.dbFiledType) {
        case DBFieldTypeEnum.VARCHAR:
            columnBuilder = builder.string(attribute.columnName, attribute.length ?? 200);
            break;
        case DBFieldTypeEnum.TEXT:
            columnBuilder = builder.text(attribute.columnName);
            break;
        case DBFieldTypeEnum.INT:
            columnBuilder = builder.integer(attribute.columnName, attribute.length ?? 10);
            break;
        case DBFieldTypeEnum.FLOAT:
            columnBuilder = builder.decimal(
                attribute.columnName,
                attribute.length ?? 10,
                (attribute as IDecimalAttribute).precise ?? 2,
            );
            break;
        case DBFieldTypeEnum.BOOLEAN:
            columnBuilder = builder.boolean(attribute.columnName);
            break;
        case DBFieldTypeEnum.TIME:
            columnBuilder = builder.time(attribute.columnName);
            break;
        case DBFieldTypeEnum.DATE:
            columnBuilder = builder.date(attribute.columnName);
            break;
        case DBFieldTypeEnum.DATETIME:
            columnBuilder = builder.datetime(attribute.columnName);
            break;
        case DBFieldTypeEnum.JSON:
            columnBuilder = builder.json(attribute.columnName);
    }
    return columnBuilder;
};

const updateDBField = (
    builder: Knex.TableBuilder,
    field: IField,
    oldAttribute: IAttribute,
    newAttribute: IAttribute,
) => {
    // Knex 对同一列连续调用多次 alter 时，后一次操作可能覆盖前一次。
    // 使用旧列名构建一次完整的列定义，重命名操作会在它之后执行。
    const attribute = {
        ...newAttribute,
        columnName: oldAttribute.columnName,
    };
    const columnBuilder = getColumnBuilder(builder, field, attribute);
    createDBFieldDefault(columnBuilder, attribute);
    createDBFieldRequired(columnBuilder, attribute);
    columnBuilder.alter();
};

export interface IModelDiff {
    tableName: string;
    attributes: IAttributeDiff;
    indexes: {
        added: IIndex[];
        removed: IIndex[];
    };
}

export interface IMigrationStatus {
    status: 'ready' | 'failed';
    error: string | null;
    updatedAt: Date | string | null;
}

export type IMigrationOperationType =
    | 'createTable'
    | 'addColumn'
    | 'dropColumn'
    | 'alterColumn'
    | 'renameColumn'
    | 'addIndex'
    | 'dropIndex'
    | 'orphanTable';

export interface IMigrationOperation {
    type: IMigrationOperationType;
    modelCode: string;
    tableName: string;
    target?: string;
    destructive: boolean;
    warning?: string;
}

export interface IMigrationPlan {
    operations: IMigrationOperation[];
    hasChanges: boolean;
    requiresBackup: boolean;
    warnings: string[];
}

export interface ISyncAllOptions {
    /** Required before executing operations that may discard or reinterpret stored data. */
    allowDestructive?: boolean;
    /** Validate all stored rows against current model types before committing. */
    validateStoredData?: boolean | IStoredDataValidationOptions;
}

interface IAttributeDiff {
    added: IAttribute[];
    removed: IAttribute[];
    modified: Record<string, Partial<Record<IAttributeDiffProp, IAttributePropertyDiff>>>;
}

type IAttributeDiffProp =
    | 'type'
    | 'length'
    | 'default'
    | 'required'
    | 'unique'
    | 'columnName';

interface IAttributePropertyDiff {
    oldValue: any;
    newValue: any;
}

const diffAttributeProps: IAttributeDiffProp[] = [
    'type',
    'length',
    'default',
    'required',
    'unique',
    // Rename the column after applying changes that still reference its old name.
    'columnName',
];

const diffAttributes = (
    oldAttributes: Record<string, IAttribute>,
    newAttributes: Record<string, IAttribute>,
): IAttributeDiff => {
    const attributeDiff: IAttributeDiff = {
        added: [],
        removed: [],
        modified: {},
    };

    // 获取所有字段名
    const allColumnCodes = new Set([...Object.keys(newAttributes), ...Object.keys(oldAttributes)]);

    // 比对字段变更
    for (const columnCode of allColumnCodes) {
        const newAttr = newAttributes[columnCode];
        const oldAttr = oldAttributes[columnCode];

        if (!oldAttr && newAttr) {
            attributeDiff.added.push(newAttr);
            continue;
        }
        if (oldAttr && !newAttr) {
            attributeDiff.removed.push(oldAttr);
            continue;
        }

        if (oldAttr && newAttr) {
            for (const prop of diffAttributeProps) {
                if (typeof oldAttr[prop] === 'undefined' && typeof newAttr[prop] === 'undefined') {
                    continue;
                }
                if (oldAttr[prop as keyof IAttribute] !== newAttr[prop]) {
                    attributeDiff.modified[columnCode] ??= {};
                    attributeDiff.modified[columnCode][prop] = {
                        oldValue: oldAttr[prop],
                        newValue: newAttr[prop],
                    };
                }
            }
        }
    }

    return attributeDiff;
};

const diffIndexes = (oldIndexes: IIndex[], newIndexes: IIndex[]): IModelDiff['indexes'] => {
    const indexesDiff: IModelDiff['indexes'] = {
        added: [],
        removed: [],
    };

    const oldIndexMap: Map<string, IIndex> = new Map(oldIndexes.map((idx) => [idx.name, idx]));
    const newIndexMap: Map<string, IIndex> = new Map(newIndexes.map((idx) => [idx.name, idx]));

    for (const [name, oldIdx] of oldIndexMap) {
        if (!newIndexMap.has(name)) {
            indexesDiff.removed.push(oldIdx);
        }
    }

    // 同名索引的字段或类型发生变化时，先删除旧索引，再创建新索引。
    for (const [name, newIdx] of newIndexMap) {
        const oldIdx = oldIndexMap.get(name);
        if (!oldIdx) {
            indexesDiff.added.push(newIdx);
            continue;
        }

        const codesChanged =
            oldIdx.codes.length !== newIdx.codes.length ||
            oldIdx.codes.some((code, index) => code !== newIdx.codes[index]);
        if (oldIdx.type !== newIdx.type || codesChanged) {
            indexesDiff.removed.push(oldIdx);
            indexesDiff.added.push(newIdx);
        }
    }

    return indexesDiff;
};

export const diffModel = (newModel: IModel, oldModel: IModel): IModelDiff => {
    const { attributes: newAttributes, indexes: newIndexes = [] } = newModel;
    const { attributes: oldAttributes, indexes: oldIndexes = [] } = oldModel;

    return {
        tableName: newModel.tableName,
        attributes: diffAttributes(oldAttributes, newAttributes),
        indexes: diffIndexes(oldIndexes, newIndexes),
    };
};

const addPlanOperation = (
    operations: IMigrationOperation[],
    operation: IMigrationOperation,
) => {
    operations.push(operation);
};

export const buildMigrationPlan = (
    currentModels: IModel[],
    previousModels: IModel[],
): IMigrationPlan => {
    const operations: IMigrationOperation[] = [];
    const previousModelMap = new Map(previousModels.map((model) => [model.code, model]));
    const currentModelCodes = new Set(currentModels.map((model) => model.code));

    for (const model of currentModels) {
        const previousModel = previousModelMap.get(model.code);
        if (!previousModel) {
            addPlanOperation(operations, {
                type: 'createTable',
                modelCode: model.code,
                tableName: model.tableName,
                destructive: false,
            });
            continue;
        }

        const diff = diffModel(model, previousModel);
        for (const attribute of diff.attributes.added) {
            addPlanOperation(operations, {
                type: 'addColumn',
                modelCode: model.code,
                tableName: model.tableName,
                target: attribute.columnName,
                destructive: false,
                warning:
                    attribute.required && attribute.default === undefined
                        ? 'Adding a required column without a default may fail when rows already exist.'
                        : undefined,
            });
        }
        for (const attribute of diff.attributes.removed) {
            addPlanOperation(operations, {
                type: 'dropColumn',
                modelCode: model.code,
                tableName: model.tableName,
                target: attribute.columnName,
                destructive: true,
                warning: 'Dropping a column permanently removes its stored data. Create a backup first.',
            });
        }
        for (const [attributeCode, propertyDiffs] of Object.entries(diff.attributes.modified)) {
            const previousAttribute = previousModel.attributes[attributeCode];
            const currentAttribute = model.attributes[attributeCode];
            const alteredProperties = (['type', 'length', 'default', 'required'] as const).filter(
                (property) => propertyDiffs[property],
            );
            if (alteredProperties.length > 0) {
                const destructive = alteredProperties.some((property) => property !== 'default');
                addPlanOperation(operations, {
                    type: 'alterColumn',
                    modelCode: model.code,
                    tableName: model.tableName,
                    target: previousAttribute.columnName,
                    destructive,
                    warning: destructive
                        ? `Changing ${alteredProperties.join(', ')} may rebuild or reinterpret existing data. Create a backup first.`
                        : undefined,
                });
            }
            if (propertyDiffs.unique) {
                addPlanOperation(operations, {
                    type: propertyDiffs.unique.newValue ? 'addIndex' : 'dropIndex',
                    modelCode: model.code,
                    tableName: model.tableName,
                    target: previousAttribute.columnName,
                    destructive: false,
                    warning: propertyDiffs.unique.newValue
                        ? 'Adding a unique constraint fails when duplicate values already exist.'
                        : undefined,
                });
            }
            if (propertyDiffs.columnName) {
                addPlanOperation(operations, {
                    type: 'renameColumn',
                    modelCode: model.code,
                    tableName: model.tableName,
                    target: `${previousAttribute.columnName} -> ${currentAttribute.columnName}`,
                    destructive: false,
                });
            }
        }
        for (const index of diff.indexes.removed) {
            addPlanOperation(operations, {
                type: 'dropIndex',
                modelCode: model.code,
                tableName: model.tableName,
                target: index.name,
                destructive: false,
            });
        }
        for (const index of diff.indexes.added) {
            addPlanOperation(operations, {
                type: 'addIndex',
                modelCode: model.code,
                tableName: model.tableName,
                target: index.name,
                destructive: false,
                warning:
                    index.type === 'unique'
                        ? 'Adding a unique index fails when duplicate values already exist.'
                        : undefined,
            });
        }
    }

    for (const previousModel of previousModels) {
        if (!currentModelCodes.has(previousModel.code)) {
            addPlanOperation(operations, {
                type: 'orphanTable',
                modelCode: previousModel.code,
                tableName: previousModel.tableName,
                destructive: false,
                warning: 'The model was removed, but its table is retained and requires manual review.',
            });
        }
    }

    const warnings = Array.from(
        new Set(
            operations
                .map((operation) => operation.warning)
                .filter((warning): warning is string => Boolean(warning)),
        ),
    );
    return {
        operations,
        hasChanges: operations.length > 0,
        requiresBackup: operations.some((operation) => operation.destructive),
        warnings,
    };
};

export class ModelTableMigrator {
    private static readonly migrationLocks = new Map<string, Promise<unknown>>();
    private static readonly databaseLockIds = new WeakMap<Database, number>();
    private static nextDatabaseLockId = 1;
    private readonly _db: Database;

    constructor(db: Database) {
        this._db = db;
        this._db.modelStore.add({
            ...modelRecord,
            attributes: Object.fromEntries(
                Object.entries(modelRecord.attributes).map(([code, attribute]) => [
                    code,
                    { ...attribute },
                ]),
            ),
            indexes: modelRecord.indexes?.map((index) => ({ ...index, codes: [...index.codes] })),
        });
    }

    private async createTable(knex: Knex, model: IModel) {
        const { tableName, attributes, indexes = [] } = model;

        if (await knex.schema.hasTable(tableName)) {
            return;
        }

        await knex.schema.createTable(tableName, (builder) => {
            // 添加模型定义的字段
            for (const [, attribute] of Object.entries(attributes)) {
                const field = this._db.fieldTypeManager.get(attribute.type);
                createDBField(builder, field, attribute);
            }

            // 添加索引
            for (const index of indexes) {
                createIndex(builder, index, attributes);
            }
        });
    }

    private async updateTable(knex: Knex, model: IModel, oldModel: IModel) {
        const { tableName, attributes } = model;
        const { attributes: oldAttributes } = oldModel;

        const diff = diffModel(model, oldModel);

        return knex.schema.alterTable(tableName, (table) => {
            // 先移除旧索引，避免同名索引重建冲突，也避免字段删除或重命名后
            // 无法再通过旧列名定位索引。
            for (const index of diff.indexes.removed) {
                dropIndex(table, index, oldAttributes);
            }

            // 更新字段
            for (const [columnCode, propertyDiffs] of Object.entries(diff.attributes.modified)) {
                const oldAttribute = oldAttributes[columnCode];
                const newAttribute = attributes[columnCode];
                const field = this._db.fieldTypeManager.get(newAttribute.type);

                if (
                    propertyDiffs.type ||
                    propertyDiffs.length ||
                    propertyDiffs.default ||
                    propertyDiffs.required
                ) {
                    updateDBField(table, field, oldAttribute, newAttribute);
                }

                if (propertyDiffs.unique) {
                    if (propertyDiffs.unique.newValue) {
                        table.unique([oldAttribute.columnName]);
                    } else {
                        table.dropUnique([oldAttribute.columnName]);
                    }
                }

                if (propertyDiffs.columnName) {
                    table.renameColumn(
                        propertyDiffs.columnName.oldValue,
                        propertyDiffs.columnName.newValue,
                    );
                }
            }
            for (const attribute of diff.attributes.added) {
                const field = this._db.fieldTypeManager.get(attribute.type);
                createDBField(table, field, attribute);
            }
            for (const attribute of diff.attributes.removed) {
                table.dropColumn(attribute.columnName);
            }

            for (const index of diff.indexes.added) {
                createIndex(table, index, attributes);
            }
        });
    }

    private isSqlite() {
        const client = String(this._db.knex.client.config.client);
        return client.includes('sqlite');
    }

    private deserializeModels(value: unknown): IModel[] {
        const models = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(models)) {
            throw new Error('Invalid migration model snapshot. Expected an array of models.');
        }
        return models;
    }

    async getPreBootStrapModels(knex: Knex = this._db.knex, lock = false) {
        if (await knex.schema.hasTable(modelRecord.tableName)) {
            let query = knex(modelRecord.tableName)
                .select('models')
                .where({ code: modelRecord.code })
                .first();
            if (lock && !this.isSqlite()) {
                query = query.forUpdate();
            }
            const res = await query;
            return res ? this.deserializeModels(res.models) : [];
        } else {
            return [];
        }
    }

    async getMigrationStatus(): Promise<IMigrationStatus | null> {
        if (!(await this._db.knex.schema.hasTable(modelRecord.tableName))) {
            return null;
        }
        if (!(await this._db.knex.schema.hasColumn(modelRecord.tableName, 'status'))) {
            return { status: 'ready', error: null, updatedAt: null };
        }
        const row = await this._db.knex(modelRecord.tableName)
            .select(['status', 'error', 'updated_at'])
            .where({ code: modelRecord.code })
            .first();
        if (!row) {
            return null;
        }
        return {
            status: row.status,
            error: row.error,
            updatedAt: row.updated_at,
        };
    }

    async saveCurrentModels(models: IModel[], knex?: Knex): Promise<boolean> {
        if (!knex) {
            return this._db.knex.transaction((trx) => this.saveCurrentModels(models, trx));
        }

        const now = new Date();
        const snapshot = {
            models: JSON.stringify(models),
            status: 'ready',
            error: null,
            updated_at: now,
        };
        const updated = await knex(modelRecord.tableName)
            .where({ code: modelRecord.code })
            .update(snapshot);
        if (!updated) {
            await knex(modelRecord.tableName).insert({
                id: uuidV4(),
                code: modelRecord.code,
                created_at: now,
                ...snapshot,
            });
        }
        return true;
    }

    async getMigrationPlan(knex: Knex = this._db.knex): Promise<IMigrationPlan> {
        const currentModels = this._db.modelStore.getModels();
        validateModels(currentModels, {
            isFieldTypeRegistered: (type) => this._db.fieldTypeManager.has(type),
            allowImplicitSystemAttributes: true,
        });
        const previousModels = await this.getPreBootStrapModels(knex);
        return buildMigrationPlan(currentModels, previousModels);
    }

    async dryRun(): Promise<IMigrationPlan> {
        return this.getMigrationPlan();
    }

    async syncAll(options: ISyncAllOptions = {}) {
        return this.withMigrationLock(async () => {
            const startedAt = Date.now();
            const currentModels = this._db.modelStore.getModels();
            this._db.diagnostics.emit({
                type: 'migration:start',
                operation: 'syncAll',
                modelCount: currentModels.length,
            });
            let result: boolean;
            try {
                validateModels(currentModels, {
                    isFieldTypeRegistered: (type) => this._db.fieldTypeManager.has(type),
                    allowImplicitSystemAttributes: true,
                });
                result = await this._db.transaction(async ({ trx }) => {
                    const preModels = await this.getPreBootStrapModels(trx, true);
                    const plan = buildMigrationPlan(currentModels, preModels);
                    if (plan.requiresBackup && !options.allowDestructive) {
                        throw new LliDbError(
                            'Destructive migration requires a verified backup and syncAll({ allowDestructive: true }).',
                            'LLI400',
                            { migrationPlan: plan },
                        );
                    }
                    const preModelMap = preModels.reduce(
                        (acc: Record<string, IModel>, cur: IModel) => {
                            acc[cur.code] = cur;
                            return acc;
                        },
                        {},
                    );
                    for (const model of currentModels) {
                        await this.sync(model, preModelMap[model.code], trx);
                    }
                    const saved = await this.saveCurrentModels(currentModels, trx);
                    if (options.validateStoredData) {
                        const report = await validateStoredData(
                            this._db,
                            options.validateStoredData === true
                                ? {}
                                : options.validateStoredData,
                            trx,
                        );
                        if (!report.ok) {
                            throw new LliDbError(
                                'Stored data validation failed during migration',
                                'LLI40020',
                                { validationReport: report },
                            );
                        }
                    }
                    return saved;
                });
            } catch (error) {
                const isConfirmationError =
                    error instanceof LliDbError && Boolean(error.detail?.migrationPlan);
                if (!isConfirmationError) {
                    try {
                        await this.recordMigrationFailure(error);
                    } catch {
                        // Status recording is best effort; preserve the original migration error.
                    }
                }
                this._db.diagnostics.emit({
                    type: 'migration:error',
                    operation: 'syncAll',
                    modelCount: currentModels.length,
                    durationMs: Date.now() - startedAt,
                    error: toDiagnosticError(error),
                });
                throw error;
            }

            if (result && this._db.config.canGenerateType) {
                const publicModels = this._db.config.models.map((model) =>
                    this._db.modelStore.get(model.code),
                );
                generateType(
                    this._db,
                    publicModels,
                    this._db.config.appRoot,
                    this._db.config.typeOutDir,
                );
            }

            this._db.diagnostics.emit({
                type: 'migration:success',
                operation: 'syncAll',
                modelCount: currentModels.length,
                durationMs: Date.now() - startedAt,
            });

            return result;
        });
    }

    private getMigrationLockKey(): string {
        const config = this._db.knex.client.config;
        const client = String(config.client);
        const connection = config.connection;
        if (client.includes('sqlite') && connection && typeof connection === 'object') {
            const filename = (connection as { filename?: unknown }).filename;
            if (typeof filename === 'string' && filename !== ':memory:') {
                return `sqlite:${resolve(filename)}`;
            }
        }

        let id = ModelTableMigrator.databaseLockIds.get(this._db);
        if (!id) {
            id = ModelTableMigrator.nextDatabaseLockId++;
            ModelTableMigrator.databaseLockIds.set(this._db, id);
        }
        return `${client}:instance:${id}`;
    }

    private async withMigrationLock<T>(operation: () => Promise<T>): Promise<T> {
        const lockKey = this.getMigrationLockKey();
        const previous = ModelTableMigrator.migrationLocks.get(lockKey) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        ModelTableMigrator.migrationLocks.set(lockKey, current);
        try {
            return await current;
        } finally {
            if (ModelTableMigrator.migrationLocks.get(lockKey) === current) {
                ModelTableMigrator.migrationLocks.delete(lockKey);
            }
        }
    }

    private async recordMigrationFailure(error: unknown) {
        const knex = this._db.knex;
        if (!(await knex.schema.hasTable(modelRecord.tableName))) {
            return;
        }
        if (
            !(await knex.schema.hasColumn(modelRecord.tableName, 'status')) ||
            !(await knex.schema.hasColumn(modelRecord.tableName, 'error'))
        ) {
            return;
        }
        const message = error instanceof Error ? error.message : String(error);
        await knex(modelRecord.tableName)
            .where({ code: modelRecord.code })
            .update({ status: 'failed', error: message.slice(0, 1000), updated_at: new Date() });
    }

    async sync(model: IModel, oldModel?: IModel, knex: Knex = this._db.knex) {
        const startedAt = Date.now();
        const operation = oldModel ? 'updateTable' : 'createTable';
        this._db.diagnostics.emit({
            type: 'migration:model:start',
            modelCode: model.code,
            operation,
        });

        try {
            const result = oldModel
                ? await this.updateTable(knex, model, oldModel)
                : await this.createTable(knex, model);
            this._db.diagnostics.emit({
                type: 'migration:model:success',
                modelCode: model.code,
                operation,
                durationMs: Date.now() - startedAt,
            });
            return result;
        } catch (error) {
            this._db.diagnostics.emit({
                type: 'migration:model:error',
                modelCode: model.code,
                operation,
                durationMs: Date.now() - startedAt,
                error: toDiagnosticError(error),
            });
            throw error;
        }
    }
}
