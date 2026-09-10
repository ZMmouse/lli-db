const assert = require('node:assert/strict');
const { Database, ModelTableMigrator, SysFieldTypeEnum } = require('@llii/db');

const model = {
    code: 'smokeUser',
    name: 'smoke user',
    tableName: 'smoke_user',
    attributes: {
        username: {
            code: 'username',
            name: 'username',
            columnName: 'user_name',
            type: SysFieldTypeEnum.TEXT,
            required: true,
            unique: true,
        },
        enabled: {
            code: 'enabled',
            name: 'enabled',
            columnName: 'is_enabled',
            type: SysFieldTypeEnum.SWITCH,
            default: true,
        },
    },
};

const db = new Database({
    connection: {
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    },
    models: [model],
});

async function main() {
    try {
        assert.equal(await new ModelTableMigrator(db).syncAll(), true);

        const created = await db.query('smokeUser').create({
            data: { username: 'alice' },
        });
        assert.equal(created.username, 'alice');
        assert.equal(Boolean(created.enabled), true);

        const found = await db.query('smokeUser').findOne({
            where: { username: 'alice' },
            select: ['id', 'username', 'enabled'],
        });
        assert.equal(found.username, 'alice');

        await db.query('smokeUser').update({
            where: { id: created.id },
            data: { username: 'alice-updated' },
        });
        assert.equal(
            (await db.query('smokeUser').findOne({ where: { id: created.id } })).username,
            'alice-updated',
        );

        await assert.rejects(
            db.transaction(async () => {
                await db.query('smokeUser').create({
                    data: { username: 'rollback-user' },
                });
                throw new Error('rollback smoke');
            }),
            /rollback smoke/,
        );
        assert.equal(
            await db.query('smokeUser').findOne({ where: { username: 'rollback-user' } }),
            null,
        );

        await db.query('smokeUser').delete({ where: { id: created.id } });
        assert.equal(await db.query('smokeUser').findOne({ where: { id: created.id } }), null);

        process.stdout.write('Package smoke passed: import, migration, CRUD, rollback.\n');
    } finally {
        await db.knex.destroy();
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
