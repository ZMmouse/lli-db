import { isPlainObject } from 'lodash';
import type { Database } from '../database';
import { DBFieldTypeEnum } from '../enum/field-type-enum';
import { LliDbError } from '../error/lli-db-error';
import type { IAction } from '../middleware-manager/types';
import type { IAttribute, IModel } from '../types/model';

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

const validateObject = (
    db: Database,
    model: IModel,
    action: 'create' | 'update',
    data: unknown,
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
            if (!childKeys.has(key) && rejectUnknown) fail(model, key, 'unknown field');
            continue;
        }
        if (strict && (attribute.readonly || attribute.generated)) {
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
                record[key] === undefined
            ) {
                fail(model, key, 'required field is missing');
            }
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
