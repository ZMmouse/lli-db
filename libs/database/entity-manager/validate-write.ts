import { isPlainObject } from 'lodash';
import type { Database } from '../database';
import {
    DBFieldTypeEnum,
    SysExpansionFieldTypeEnum,
    SysFieldTypeEnum,
} from '../enum/field-type-enum';
import { LliDbError } from '../error/lli-db-error';
import type { IAction } from '../middleware-manager/types';
import type { IAttribute, IModel } from '../types/model';
import { toChildValueKey } from './transform';

const writeActions = new Set<IAction>(['create', 'createMany', 'update', 'updateMany']);

const isCanonicalDate = (value: string) => {
    const timestamp = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
};

const fail = (model: IModel, field: string, reason: string): never => {
    throw new LliDbError(
        `Strict validation failed for ${model.code}.${field}: ${reason}`,
        'LLI40020',
        { modelCode: model.code, fieldCode: field, reason },
    );
};

const validateJsonValue = (
    value: unknown,
    model: IModel,
    field: string,
    seen = new Set<object>(),
): void => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) fail(model, field, 'expected a finite JSON number');
        return;
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) fail(model, field, 'circular JSON value');
        seen.add(value);
        value.forEach((item) => validateJsonValue(item, model, field, seen));
        seen.delete(value);
        return;
    }
    if (isPlainObject(value)) {
        if (seen.has(value as object)) fail(model, field, 'circular JSON value');
        seen.add(value as object);
        for (const item of Object.values(value as Record<string, unknown>)) {
            validateJsonValue(item, model, field, seen);
        }
        seen.delete(value as object);
        return;
    }
    fail(model, field, 'expected a JSON value');
};

export const validateStrictFieldValue = (
    db: Database,
    model: IModel,
    field: string,
    attribute: IAttribute,
    value: unknown,
) => {
    if (value === null) {
        if (attribute.required) fail(model, field, 'required field cannot be null');
        return;
    }

    if (attribute.type === SysFieldTypeEnum.MULTI_QUOTE) {
        if (
            !Array.isArray(value) ||
            value.some((item) => typeof item !== 'string' || item.length === 0)
        ) {
            fail(model, field, 'expected an array of non-empty reference ids');
        }
        return;
    }
    if (
        attribute.type === SysExpansionFieldTypeEnum.JSON_ARRAY ||
        attribute.type === SysExpansionFieldTypeEnum.MULTI_SELECT
    ) {
        if (!Array.isArray(value)) fail(model, field, 'expected an array');
        validateJsonValue(value, model, field);
        return;
    }
    if (attribute.type === SysExpansionFieldTypeEnum.JSON_OBJECT) {
        if (!isPlainObject(value)) fail(model, field, 'expected a JSON object');
        validateJsonValue(value, model, field);
        return;
    }

    const base = db.fieldTypeManager.getBaseFieldType(attribute.type);
    switch (base.dbFiledType) {
        case DBFieldTypeEnum.VARCHAR:
        case DBFieldTypeEnum.TEXT:
        case DBFieldTypeEnum.TIME:
            if (typeof value !== 'string') fail(model, field, 'expected a string');
            return;
        case DBFieldTypeEnum.INT:
            if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
                fail(model, field, 'expected a safe integer');
            }
            return;
        case DBFieldTypeEnum.FLOAT:
            if (typeof value !== 'number' || !Number.isFinite(value)) {
                fail(model, field, 'expected a finite number');
            }
            return;
        case DBFieldTypeEnum.BOOLEAN:
            if (typeof value !== 'boolean') fail(model, field, 'expected a boolean');
            return;
        case DBFieldTypeEnum.DATE:
            if (
                typeof value !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
                !isCanonicalDate(value)
            ) {
                fail(model, field, 'expected YYYY-MM-DD');
            }
            return;
        case DBFieldTypeEnum.DATETIME: {
            if (value instanceof Date && Number.isFinite(value.getTime())) return;
            if (db.config.validation?.datetimeFormat !== 'iso-utc-ms') {
                if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return;
                fail(model, field, 'expected a valid datetime');
            }
            if (
                typeof value !== 'string' ||
                !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
                !Number.isFinite(Date.parse(value)) ||
                new Date(value).toISOString() !== value
            ) {
                fail(model, field, 'expected an ISO UTC datetime with millisecond precision');
            }
            return;
        }
        case DBFieldTypeEnum.JSON:
            validateJsonValue(value, model, field);
            return;
        default:
            fail(model, field, 'unsupported strict field type');
    }
};

interface IValidateObjectOptions {
    allowedManagedFields?: Set<string>;
    allowedExtraFields?: Set<string>;
    ignoredRequiredFields?: Set<string>;
}

const isImplicitlyGenerated = (attribute: IAttribute) =>
    attribute.type === SysExpansionFieldTypeEnum.UID ||
    attribute.type === SysExpansionFieldTypeEnum.REVISION;

const validateObject = (
    db: Database,
    model: IModel,
    action: 'create' | 'update',
    data: unknown,
    options: IValidateObjectOptions = {},
) => {
    if (!isPlainObject(data)) {
        throw new LliDbError('data must be an object', 'LLI40020', {
            modelCode: model.code,
            reason: 'expected an object',
        });
    }
    const record = data as Record<string, unknown>;

    const strict = db.config.validation?.mode === 'strict';
    const rejectUnknown = strict || db.config.validation?.rejectUnknownFields === true;
    const childKeys = new Set((model.childCodes ?? []).map((code) => `${code}List`));

    if (strict && action === 'update' && Object.keys(record).length === 0) {
        fail(model, 'data', 'update data cannot be empty');
    }

    for (const key of Object.keys(record)) {
        const attribute = model.attributes[key];
        if (!attribute) {
            if (!childKeys.has(key) && !options.allowedExtraFields?.has(key) && rejectUnknown) {
                fail(model, key, 'unknown field');
            }
            continue;
        }
        if (
            strict &&
            !options.allowedManagedFields?.has(key) &&
            (attribute.readonly || attribute.generated || isImplicitlyGenerated(attribute))
        ) {
            fail(model, key, 'field is managed by the database');
        }
        if (strict) validateStrictFieldValue(db, model, key, attribute, record[key]);
    }

    if (strict && action === 'create') {
        for (const [key, attribute] of Object.entries(model.attributes)) {
            if (
                attribute.required &&
                attribute.default === undefined &&
                !attribute.generated &&
                !isImplicitlyGenerated(attribute) &&
                !options.ignoredRequiredFields?.has(key) &&
                record[key] === undefined
            ) {
                fail(model, key, 'required field is missing');
            }
        }
    }

    if (strict) {
        for (const childCode of model.childCodes ?? []) {
            const childKey = toChildValueKey(childCode);
            const childData = record[childKey];
            if (childData === undefined) continue;
            if (!Array.isArray(childData)) fail(model, childKey, 'expected an array');
            const childModel = db.modelStore.get(childCode);
            (childData as unknown[]).forEach((item) => {
                if (!isPlainObject(item)) fail(childModel, 'data', 'expected an object');
                const operation = (item as Record<string, unknown>).__op;
                if (
                    operation !== undefined &&
                    operation !== 'create' &&
                    operation !== 'update' &&
                    operation !== 'delete'
                ) {
                    fail(childModel, '__op', 'expected create, update, or delete');
                }
                const isExisting = operation === 'update' || operation === 'delete';
                if (isExisting && typeof (item as Record<string, unknown>).id !== 'string') {
                    fail(childModel, 'id', 'expected an id for update or delete');
                }
                validateObject(db, childModel, isExisting ? 'update' : 'create', item, {
                    allowedManagedFields: isExisting ? new Set(['id']) : undefined,
                    allowedExtraFields: new Set(['__op']),
                    ignoredRequiredFields: childModel.parentRefFieldCode
                        ? new Set([childModel.parentRefFieldCode])
                        : undefined,
                });
            });
        }
    }
};

export const validateWriteParams = (
    db: Database,
    model: IModel,
    action: IAction,
    params: Record<string, unknown>,
) => {
    if (!writeActions.has(action)) return;
    if (action === 'createMany') {
        if (!Array.isArray(params.data)) {
            throw new LliDbError('data must be an array', 'LLI40020', {
                modelCode: model.code,
                reason: 'expected an array',
            });
        }
        params.data.forEach((item) => validateObject(db, model, 'create', item));
        return;
    }
    validateObject(db, model, action === 'create' ? 'create' : 'update', params.data);
};
