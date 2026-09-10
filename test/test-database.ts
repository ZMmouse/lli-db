import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '../libs';
import { ModelTableMigrator } from '../libs/migrator';
import models from '../examples/models';

const testModelCodes = new Set([
    'sysUser',
    'sysRole',
    'sysUserRole',
    'sysUserFriend',
    'testAllField',
]);

const testDirectory = mkdtempSync(join(tmpdir(), 'lli-db-jest-'));
const databaseFilename = join(testDirectory, 'test.sqlite3');

export const db = new Database({
    connection: {
        client: 'better-sqlite3',
        connection: {
            filename: databaseFilename,
        },
        useNullAsDefault: true,
        pool: {
            min: 1,
            max: 1,
        },
    },
    models: models.filter((model) => testModelCodes.has(model.code)),
    modelConfig: {
        userModelCode: 'sysUser',
        userModelDisplayCode: 'nickname',
    },
    encrypt: {
        key: '0'.repeat(32),
        iv: '0'.repeat(16),
        salt: 'lliidb-test',
    },
});

const seedDatabase = async () => {
    await db.knex('sys_user').insert([
        {
            id: '1', username: 'admin', nickname: 'admin', password: 'pwd',
            email: 'admin@admin.example.com', phone: '12345678901', money: 100,
            created_at: '2025-07-08T03:50:03.700Z', created_by: '1', deleted: false,
        },
        {
            id: '2', username: 'm01', nickname: 'm01', password: 'pwd',
            email: 'm01@m.example.com', phone: '12345678901', money: 1000,
            created_at: '2025-07-08T03:50:04.073Z', created_by: '1',
            updated_by: '1', deleted: false,
        },
        {
            id: '3', username: 'm02', nickname: 'm02', password: 'pwd',
            email: 'm02@m.example.com', phone: '12345678901', money: 500,
            created_at: '2025-07-08T03:50:04.073Z', created_by: '1',
            updated_by: '1', deleted: false,
        },
        {
            id: '4', username: 'n01', nickname: 'n01', password: 'n01',
            email: 'n01@n.example.com', phone: 'n01', money: 0,
            created_by: '2', deleted: false,
        },
    ]);

    await db.knex('sys_role').insert([
        { id: '1', name: '管理员', created_by: '1', deleted: false },
        { id: '2', name: '普通用户', created_by: '1', deleted: false },
    ]);

    await db.knex('sys_user_role').insert([
        { id: '1', user_id: '1', role_id: '1', deleted: false },
        { id: '2', user_id: '2', role_id: '2', deleted: false },
        { id: '3', user_id: '3', role_id: '2', deleted: false },
        { id: '4', user_id: '3', role_id: '1', deleted: false },
    ]);

    await db.knex('sys_user_friend').insert([
        { id: '1', user_id: '2', friend_id: '1', is_top: 0, deleted: false },
    ]);
};

beforeAll(async () => {
    const migrator = new ModelTableMigrator(db);
    await migrator.syncAll();
    await seedDatabase();
});

afterAll(async () => {
    await db.knex.destroy();
    rmSync(testDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
});
