const { app } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { Database, ModelTableMigrator, SysFieldTypeEnum } = require('../dist');

const model = {
    code: 'electronSmoke',
    name: 'electron smoke',
    tableName: 'electron_smoke',
    useRevision: true,
    attributes: {
        title: {
            code: 'title',
            name: 'title',
            columnName: 'title',
            type: SysFieldTypeEnum.TEXT,
            required: true,
        },
    },
};

app.whenReady().then(async () => {
    const directory = mkdtempSync(join(app.getPath('temp'), 'lli-db-electron-smoke-'));
    const databasePath = join(directory, 'electron-smoke.sqlite3');
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: databasePath },
            useNullAsDefault: true,
        },
        models: [model],
    });
    try {
        await new ModelTableMigrator(db).syncAll();
        const created = await db.query('electronSmoke').create({ data: { title: 'abi-ok' } });
        const updated = await db.query('electronSmoke').update({
            where: { id: created.id },
            expectedRevision: 1,
            data: { title: 'updated' },
        });
        await assert.rejects(
            db.transaction(async () => {
                await db.query('electronSmoke').create({ data: { title: 'rollback' } });
                throw new Error('rollback smoke');
            }),
            /rollback smoke/,
        );
        assert.equal(
            await db.query('electronSmoke').findOne({ where: { title: 'rollback' } }),
            null,
        );
        const page = await db.query('electronSmoke').findCursorPage({
            orderBy: [{ field: 'title', direction: 'asc' }],
            limit: 10,
        });
        if (!updated || updated.revision !== 2 || page.rows.length !== 1) {
            throw new Error('database contract round trip failed');
        }
        await db.close();
        const reopened = new Database({
            connection: {
                client: 'better-sqlite3',
                connection: { filename: databasePath },
                useNullAsDefault: true,
            },
            models: [model],
        });
        try {
            assert.equal(await reopened.query('electronSmoke').count(), 1);
        } finally {
            await reopened.close();
        }
        process.stdout.write('LLI_DB_ELECTRON_SMOKE_OK\n');
        rmSync(directory, { recursive: true, force: true });
        app.exit(0);
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
        await db.close().catch(() => undefined);
        rmSync(directory, { recursive: true, force: true });
        app.exit(1);
    }
});
