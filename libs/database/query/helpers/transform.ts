import { has, isNil, isPlainObject } from 'lodash';
import type { IModel } from '../../types/model';
import { IRow } from '../../types/i-row';
import { typeUtil } from '../../utils';
import { LliDbError } from '../../error/lli-db-error';
import type { Database } from '../../database';

export const toColumnName = (model: IModel, code: string) => {
    if (!code) {
        LliDbError.throw500('code不能为空');
    }
    const attribute = model.attributes[code];
    if (!attribute) {
        return code;
    }
    if ('columnName' in attribute && attribute.columnName) {
        return attribute.columnName;
    }
    return code;
};

export const toRow = (model: IModel, data: IRow | IRow[] | null): IRow | IRow[] | null => {
    if (!data) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map((item) => toRow(model, item)) as IRow[];
    }

    if (isPlainObject(data)) {
        const { attributes } = model;
        const row = { ...data };

        for (const key of Object.keys(row)) {
            const attribute = attributes[key];

            if (
                !attribute ||
                !('columnName' in attribute) ||
                !attribute.columnName ||
                attribute.columnName === key
            ) {
                continue;
            }

            row[attribute.columnName] = row[key];
            delete row[key];
        }
        return row;
    }

    // 类型错误
    LliDbError.throw400('data的类型必须是object、array');
};

const fromSingleRow = (db: Database, meta: IModel, row: IRow) => {
    if (isNil(row)) {
        return null;
    }

    for (const column in row) {
        if (!has(meta.attributes, column)) {
            continue;
        }

        const attribute = meta.attributes[column];
        const field = db.fieldTypeManager.get(attribute.type);
        if (!typeUtil.isQuote(attribute)) {
            row[column] = row[column] === null ? null : field.fromDB(row[column], db, attribute);
        }
    }
    return row;
};

export const fromRow = (db: Database, meta: IModel, row: IRow | IRow[] | undefined) => {
    if (isNil(row)) {
        return null;
    }

    if (Array.isArray(row)) {
        return row.map((singleRow) => fromSingleRow(db, meta, singleRow));
    }

    return fromSingleRow(db, meta, row);
};
