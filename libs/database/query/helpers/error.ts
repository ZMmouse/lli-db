import { camelCase } from 'lodash';
import { Knex } from 'knex';
import { IModel } from '../../types/model';
import { getDatabaseDriverCompatibility } from '../../driver-compatibility';

// 判断是否为重复键错误
export function isDuplicateKeyError(knex: Knex, error: any) {
    // 根据不同数据库驱动识别错误
    const DUPLICATE_ERROR_CODES = {
        postgresql: '23505', // PostgreSQL unique_violation
        sqlite3: 'SQLITE_CONSTRAINT', // SQLite
    };

    const dbType = String(knex.client.config.client);
    const driver = getDatabaseDriverCompatibility(dbType);

    if (driver.family === 'sqlite') {
        return (
            String(error.code).startsWith(DUPLICATE_ERROR_CODES.sqlite3) &&
            /UNIQUE constraint failed/i.test(error.message)
        );
    }
    if (driver.family === 'postgresql') {
        return error.code === DUPLICATE_ERROR_CODES.postgresql;
    }

    return false;
}

export function extractDuplicateField(knex: Knex, error: any) {
    const driver = getDatabaseDriverCompatibility(knex.client.config.client);
    // PostgreSQL: 从 detail 中提取
    if (driver.family === 'postgresql') {
        const match = error.detail?.match(/Key \((.*?)\)=\(.*?\) already exists/);
        return match ? match[1] : 'unknown_field';
    }

    // SQLite: 从消息中提取
    if (driver.family === 'sqlite') {
        const match = error.message.match(/UNIQUE constraint failed: \w+\.(.*)/);
        return match ? match[1] : 'unknown_field';
    }

    return '';
}

export function getDuplicateErrorMessage(knex: Knex, model: IModel, error: any) {
    const columnName = extractDuplicateField(knex, error);

    const code = camelCase(columnName);

    if (code in model.attributes) {
        const attribute = model.attributes[code];
        return {
            code,
            name: attribute.name,
            message: attribute.name + '已存在',
        };
    }

    for (const [code, attr] of Object.entries(model.attributes)) {
        if (attr.columnName === columnName) {
            return {
                code,
                name: attr.name,
                message: attr.name + '已存在',
            };
        }
    }
    return {
        code: '',
        name: '',
        message: '字段重复了',
    };
}
