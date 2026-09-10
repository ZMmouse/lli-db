import { Database, SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../libs';
import type { IAttribute, IDatabaseConfig } from '../libs';

const databases: Database[] = [];

const createDatabase = (encrypt?: IDatabaseConfig['encrypt']) => {
    const db = new Database({
        connection: {
            client: 'better-sqlite3',
            connection: { filename: ':memory:' },
            useNullAsDefault: true,
        },
        models: [],
        encrypt,
    });
    databases.push(db);
    return db;
};

const aesAttribute: IAttribute = {
    code: 'secret',
    name: 'secret',
    columnName: 'secret',
    type: SysExpansionFieldTypeEnum.ENCRYPT_TEXT,
    primitiveType: SysFieldTypeEnum.TEXT,
    expansionConfig: { type: 'aes-256-gcm' },
};

afterEach(async () => {
    await Promise.all(databases.splice(0).map((db) => db.knex.destroy()));
});

describe('encryption configuration', () => {
    test('database can initialize without encryption configuration', () => {
        expect(() => createDatabase()).not.toThrow();
    });

    test('SHA-256 does not require an AES key or IV', () => {
        const db = createDatabase();

        expect(db.encrypt.sha256('secret')).toMatch(/^\$EN\$[a-f0-9]{64}$/);
    });

    test('AES field reports a clear error when the default key is missing', () => {
        const db = createDatabase();
        const field = db.fieldTypeManager.get(SysExpansionFieldTypeEnum.ENCRYPT_TEXT);

        expect(() => field.toDB('secret', db, aesAttribute)).toThrow(
            'Encryption key is required. Configure encrypt.key or expansionConfig.key.',
        );
    });

    test('legacy AES data reports a clear error when the default IV is missing', () => {
        const db = createDatabase({ key: 'k'.repeat(32) });

        expect(() => db.encrypt.decrypt('$EN$00')).toThrow(
            'Encryption IV is required to decrypt legacy aes-256-cbc data. Configure encrypt.iv or expansionConfig.iv.',
        );
    });

    test('AES-GCM field can use a per-field key without database defaults', () => {
        const db = createDatabase();
        const field = db.fieldTypeManager.get(SysExpansionFieldTypeEnum.ENCRYPT_TEXT);
        const attribute: IAttribute = {
            ...aesAttribute,
            expansionConfig: {
                type: 'aes-256-cbc',
                key: 'k'.repeat(32),
            },
        };

        const encrypted = field.toDB('secret', db, attribute) as string;

        expect(encrypted).toMatch(/^\$EN\$v2\$/);
        expect(field.fromDB(encrypted, db, attribute)).toBe('secret');
    });

    test('unencrypted legacy values can be read without AES configuration', () => {
        const db = createDatabase();

        expect(db.encrypt.decrypt('plain text')).toBe('plain text');
    });
});
