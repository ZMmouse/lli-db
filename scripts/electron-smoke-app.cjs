const { app } = require('electron');
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
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
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
        await db.transaction(async () => {
            await db.query('electronSmoke').create({ data: { title: 'transaction' } });
        });
        const page = await db.query('electronSmoke').findCursorPage({
            orderBy: [{ field: 'title', direction: 'asc' }],
            limit: 10,
        });
        if (!updated || updated.revision !== 2 || page.rows.length !== 2) {
            throw new Error('database contract round trip failed');
        }
        process.stdout.write('LLI_DB_ELECTRON_SMOKE_OK\n');
        await db.close();
        app.exit(0);
    } catch (error) {
        process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
        await db.close().catch(() => undefined);
        app.exit(1);
    }
});
