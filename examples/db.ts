import { Database } from '../libs';
import models from './models';
import { resolve } from 'node:path';

export const db = new Database({
    connection: {
        client: 'better-sqlite3',
        connection: {
            filename: process.env.LLI_DB_EXAMPLE_PATH ?? resolve(process.cwd(), 'data.sqlite3'),
        },
        useNullAsDefault: true,
        pool: {
            min: 2,
            max: 8,
        },
    },
    models,
    canGenerateType: true,
    modelConfig: {
        userModelCode: 'sysUser',
        userModelDisplayCode: 'nickname',
    },
    encrypt: {
        key: '0'.repeat(32),
        iv: '0'.repeat(16),
        salt: 'lliidb-example',
    },
});
