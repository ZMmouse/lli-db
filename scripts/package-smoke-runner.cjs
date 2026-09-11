const assert = require('node:assert/strict');
const { rmSync } = require('node:fs');
const { join } = require('node:path');
const { Database, ModelTableMigrator, SysFieldTypeEnum } = require('@llii/db');

const databasePath = join(process.cwd(), 'smoke.sqlite3');
const backupPath = join(process.cwd(), 'smoke-backup.sqlite3');

const model = {
    code: 'smokeUser',
    name: 'smoke user',
    tableName: 'smoke_user',
    useRevision: true,
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
        connection: { filename: databasePath },
        useNullAsDefault: true,
        pool: { min: 1, max: 3 },
    },
    models: [model],
    validation: { mode: 'strict', rejectUnknownFields: true },
    sqlite: { journalMode: 'wal', foreignKeys: true, busyTimeoutMs: 1000 },
    readSnapshots: { maxActive: 1, maxLifetimeMs: 5000 },
});

async function main() {
    try {
        assert.equal(await new ModelTableMigrator(db).syncAll(), true);

        const created = await db.query('smokeUser').create({
            data: { username: 'alice' },
        });
        assert.equal(created.username, 'alice');
        assert.equal(Boolean(created.enabled), true);
        assert.equal(created.revision, 1);

        const found = await db.query('smokeUser').findOne({
            where: { username: 'alice' },
            select: ['id', 'username', 'enabled'],
        });
        assert.equal(found.username, 'alice');

        await db.query('smokeUser').update({
            where: { id: created.id },
            expectedRevision: 1,
            data: { username: 'alice-updated' },
        });
        const updated = await db.query('smokeUser').findOne({ where: { id: created.id } });
        assert.equal(updated.username, 'alice-updated');
        assert.equal(updated.revision, 2);
        await db.query('smokeUser').create({ data: { username: 'bob' } });

        await assert.rejects(
            db.query('smokeUser').update({
                where: { id: created.id },
                expectedRevision: 1,
                data: { username: 'stale' },
            }),
            (error) => error.code === 'LLI40901',
        );

        const cursorPage = await db.query('smokeUser').findCursorPage({
            orderBy: [{ field: 'username', direction: 'asc' }],
            limit: 1,
        });
        assert.equal(cursorPage.rows.length, 1);
        assert.equal(cursorPage.nextPosition.username, 'alice-updated');

        const snapshot = await db.openReadSnapshot();
        try {
            assert.equal(await snapshot.query('smokeUser').count(), 2);
        } finally {
            await snapshot.close();
        }

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

        assert.equal((await db.validateStoredData()).ok, true);
        assert.equal((await db.integrityCheck()).ok, true);
        assert.equal((await db.backup({ destination: backupPath, verify: true })).verified, true);

        await db.query('smokeUser').delete({
            where: { id: created.id },
            expectedRevision: 2,
        });
        assert.equal(await db.query('smokeUser').findOne({ where: { id: created.id } }), null);

        process.stdout.write(
            'Package smoke passed: import, migration, strict CRUD, revision, cursor, snapshot, backup, validation, rollback, close.\n',
        );
    } finally {
        await db.close();
        for (const path of [
            databasePath,
            `${databasePath}-wal`,
            `${databasePath}-shm`,
            backupPath,
        ]) {
            rmSync(path, { force: true });
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
