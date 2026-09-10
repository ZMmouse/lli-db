import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    databaseDriverCompatibility,
    Database,
    getDatabaseDriverCompatibility,
    ModelTableMigrator,
    SysFieldTypeEnum,
} from '../libs';
import type { IModel } from '../libs';

const contractModel: IModel = {
    code: 'driverContract',
    name: 'driver contract',
    tableName: 'driver_contract',
    attributes: {
        email: {
            code: 'email',
            name: 'email',
            columnName: 'email_address',
            type: SysFieldTypeEnum.TEXT,
            unique: true,
            required: true,
        },
    },
};

describe('database driver compatibility', () => {
    test('the verified matrix stays aligned with installed contract-test versions', () => {
        const packageJson = JSON.parse(
            readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
        ) as {
            dependencies: Record<string, string>;
            devDependencies: Record<string, string>;
        };
        const sqlite = databaseDriverCompatibility['better-sqlite3'];

        expect(sqlite).toMatchObject({
            family: 'sqlite',
            support: 'supported',
            tested: true,
            knexVersion: packageJson.dependencies.knex,
            driverVersion: packageJson.devDependencies['better-sqlite3'],
        });
        expect(databaseDriverCompatibility.pg).toMatchObject({
            family: 'postgresql',
            support: 'preview',
            tested: false,
        });
    });

    test('unknown Knex clients are rejected before Knex attempts to load a driver', () => {
        expect(() =>
            new Database({
                connection: { client: 'mysql2' },
                models: [],
            }),
        ).toThrow(
            expect.objectContaining({
                code: 'LLI400',
                detail: {
                    compatibility: expect.objectContaining({ support: 'unsupported' }),
                },
            }),
        );
    });

    test('better-sqlite3 passes the migration and CRUD contract', async () => {
        const db = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: ':memory:' },
                useNullAsDefault: true,
            },
            models: [contractModel],
        });
        const migrator = new ModelTableMigrator(db);

        try {
            await expect(migrator.syncAll()).resolves.toBe(true);
            const created = await db.query('driverContract').create({
                data: { email: 'first@example.com' },
            });
            await expect(
                db.query('driverContract').create({ data: { email: 'first@example.com' } }),
            ).rejects.toMatchObject({
                code: 'LLI40010',
                detail: { code: 'email', name: 'email' },
            });

            await db.query('driverContract').update({
                where: { id: created.id },
                data: { email: 'updated@example.com' },
            });
            await expect(
                db.query('driverContract').findOne({ where: { id: created.id } }),
            ).resolves.toMatchObject({ email: 'updated@example.com' });

            await expect(
                db.transaction(async () => {
                    await db.query('driverContract').create({
                        data: { email: 'rolled-back@example.com' },
                    });
                    throw new Error('rollback contract');
                }),
            ).rejects.toThrow('rollback contract');
            await expect(
                db.query('driverContract').findOne({
                    where: { email: 'rolled-back@example.com' },
                }),
            ).resolves.toBeNull();

            await db.query('driverContract').delete({ where: { id: created.id } });
            await expect(
                db.query('driverContract').findOne({ where: { id: created.id } }),
            ).resolves.toBeNull();
        } finally {
            await db.knex.destroy();
        }
    });

    test('SQLite and PostgreSQL aliases resolve to consistent driver families', () => {
        expect(getDatabaseDriverCompatibility('sqlite3').family).toBe('sqlite');
        expect(getDatabaseDriverCompatibility('better-sqlite3').family).toBe('sqlite');
        expect(getDatabaseDriverCompatibility('pg').family).toBe('postgresql');
        expect(getDatabaseDriverCompatibility('postgres').family).toBe('postgresql');
        expect(getDatabaseDriverCompatibility('postgresql').family).toBe('postgresql');
    });
});
