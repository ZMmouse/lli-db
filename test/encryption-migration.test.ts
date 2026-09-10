import * as crypto from 'node:crypto';
import { Database, SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../libs';
import type { IModel } from '../libs';
import { ModelTableMigrator } from '../libs/migrator';

const KEY = Buffer.from('k'.repeat(32));
const LEGACY_IV = Buffer.from('i'.repeat(16));
const LEGACY_SALT = 'legacy-salt';

const secureRecord: IModel = {
    code: 'secureRecord',
    name: 'secure record',
    tableName: 'secure_records',
    attributes: {
        secret: {
            code: 'secret',
            name: 'secret',
            columnName: 'secret',
            type: SysExpansionFieldTypeEnum.ENCRYPT_TEXT,
            primitiveType: SysFieldTypeEnum.TEXT,
            expansionConfig: { type: 'aes-256-gcm' },
        },
        password: {
            code: 'password',
            name: 'password',
            columnName: 'password',
            type: SysExpansionFieldTypeEnum.ENCRYPT_TEXT,
            primitiveType: SysFieldTypeEnum.TEXT,
        },
    },
};

const createLegacyCiphertext = (text: string) => {
    const cipher = crypto.createCipheriv('aes-256-cbc', KEY, LEGACY_IV);
    return `$EN$${cipher.update(text, 'utf8', 'hex')}${cipher.final('hex')}`;
};

describe('encryption data migration', () => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
            pool: { min: 1, max: 1 },
        },
        models: [secureRecord],
        encrypt: { key: KEY, iv: LEGACY_IV, salt: LEGACY_SALT },
    });

    beforeAll(async () => {
        await new ModelTableMigrator(db).syncAll();
    });

    afterAll(async () => {
        await db.knex.destroy();
    });

    test('reads legacy values and persists their upgraded formats', async () => {
        const legacySecret = createLegacyCiphertext('legacy secret');
        const legacyPassword = db.encrypt.sha256('password', LEGACY_SALT);
        await db.knex('secure_records').insert({
            id: 'legacy-1',
            secret: legacySecret,
            password: legacyPassword,
        });

        const record = await db.query('secureRecord').findOne({ where: { id: 'legacy-1' } });
        if (!record) throw new Error('expected legacy secure record');
        expect(record.secret).toBe('legacy secret');
        expect(db.encrypt.verifyHash('password', record.password, LEGACY_SALT)).toBe(true);

        const upgradedSecret = db.encrypt.upgradeEncryption(legacySecret);
        const upgradedPassword = db.encrypt.hash('password');
        await db.query('secureRecord').update({
            where: { id: 'legacy-1' },
            data: {
                secret: upgradedSecret,
                password: upgradedPassword,
            },
        });

        const raw = await db.knex('secure_records').where({ id: 'legacy-1' }).first();
        expect(raw.secret).toMatch(/^\$EN\$v2\$/);
        expect(raw.password).toMatch(/^\$SC\$1\$/);
        expect(db.encrypt.needsEncryptionUpgrade(raw.secret)).toBe(false);
        expect(db.encrypt.needsHashUpgrade(raw.password)).toBe(false);

        const upgraded = await db.query('secureRecord').findOne({ where: { id: 'legacy-1' } });
        if (!upgraded) throw new Error('expected upgraded secure record');
        expect(upgraded.secret).toBe('legacy secret');
        expect(db.encrypt.verifyHash('password', upgraded.password)).toBe(true);
    });
});
