import * as crypto from 'node:crypto';
import { Database, SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../libs';
import type { IAttribute, IDatabaseConfig } from '../libs';

const KEY = Buffer.from('k'.repeat(32));
const OTHER_KEY = Buffer.from('x'.repeat(32));
const LEGACY_IV = Buffer.from('i'.repeat(16));
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

const createLegacyCiphertext = (text: string) => {
    const cipher = crypto.createCipheriv('aes-256-cbc', KEY, LEGACY_IV);
    return `$EN$${cipher.update(text, 'utf8', 'hex')}${cipher.final('hex')}`;
};

afterEach(async () => {
    await Promise.all(databases.splice(0).map((db) => db.knex.destroy()));
});

describe('authenticated encryption', () => {
    test('uses a random nonce for every AES-256-GCM encryption', () => {
        const db = createDatabase({ key: KEY });

        const first = db.encrypt.encrypt('secret');
        const second = db.encrypt.encrypt('secret');

        expect(first).toMatch(/^\$EN\$v2\$[a-f0-9]{24}\$[a-f0-9]{32}\$[a-f0-9]+$/);
        expect(second).not.toBe(first);
        expect(db.encrypt.decrypt(first)).toBe('secret');
        expect(db.encrypt.decrypt(second)).toBe('secret');
    });

    test('rejects tampered ciphertext instead of returning an empty string', () => {
        const db = createDatabase({ key: KEY });
        const encrypted = db.encrypt.encrypt('secret');
        const parts = encrypted.split('$');
        const lastTagCharacter = parts[4][parts[4].length - 1];
        parts[4] = `${parts[4].slice(0, -1)}${lastTagCharacter === '0' ? '1' : '0'}`;

        expect(() => db.encrypt.decrypt(parts.join('$'))).toThrow(
            'Encrypted value authentication failed. The key or ciphertext is invalid.',
        );
    });

    test('rejects a wrong GCM key', () => {
        const writer = createDatabase({ key: KEY });
        const reader = createDatabase({ key: OTHER_KEY });
        const encrypted = writer.encrypt.encrypt('secret');

        expect(() => reader.encrypt.decrypt(encrypted)).toThrow(
            'Encrypted value authentication failed. The key or ciphertext is invalid.',
        );
    });

    test('reads legacy CBC data and upgrades it to the versioned GCM format', () => {
        const db = createDatabase({ key: KEY, iv: LEGACY_IV });
        const legacy = createLegacyCiphertext('legacy secret');

        expect(db.encrypt.needsEncryptionUpgrade(legacy)).toBe(true);
        expect(db.encrypt.decrypt(legacy)).toBe('legacy secret');

        const upgraded = db.encrypt.upgradeEncryption(legacy);
        expect(upgraded).toMatch(/^\$EN\$v2\$/);
        expect(db.encrypt.needsEncryptionUpgrade(upgraded)).toBe(false);
        expect(db.encrypt.decrypt(upgraded)).toBe('legacy secret');
    });

    test('throws when legacy CBC data cannot be decrypted', () => {
        const db = createDatabase({ key: OTHER_KEY, iv: LEGACY_IV });

        expect(() => db.encrypt.decrypt(createLegacyCiphertext('legacy secret'))).toThrow(
            'Legacy encrypted value could not be decrypted. The key, IV, or ciphertext is invalid.',
        );
    });
});

describe('password hashing', () => {
    test('uses scrypt with a different random salt for each hash', () => {
        const db = createDatabase();

        const first = db.encrypt.hash('password');
        const second = db.encrypt.hash('password');

        expect(first).toMatch(/^\$SC\$1\$16384\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
        expect(first.length).toBeLessThanOrEqual(200);
        expect(second).not.toBe(first);
        expect(db.encrypt.verifyHash('password', first)).toBe(true);
        expect(db.encrypt.verifyHash('wrong password', first)).toBe(false);
    });

    test('verifies legacy SHA-256 hashes and marks them for upgrade', () => {
        const db = createDatabase();
        const legacy = db.encrypt.sha256('password', 'legacy-salt');

        expect(db.encrypt.verifyHash('password', legacy, 'legacy-salt')).toBe(true);
        expect(db.encrypt.verifyHash('wrong password', legacy, 'legacy-salt')).toBe(false);
        expect(db.encrypt.verifyHash(legacy, legacy, 'legacy-salt')).toBe(false);
        expect(db.encrypt.needsHashUpgrade(legacy)).toBe(true);
        expect(db.encrypt.needsHashUpgrade(db.encrypt.hash('password'))).toBe(false);
    });

    test('rejects malformed or unsupported scrypt hashes', () => {
        const db = createDatabase();

        expect(db.encrypt.verifyHash('password', '$SC$2$16384$8$1$00$00')).toBe(false);
        expect(db.encrypt.verifyHash('password', '$SC$1$999999$8$1$00$00')).toBe(false);
    });

    test('EncryptText hashes with scrypt by default', () => {
        const db = createDatabase();
        const field = db.fieldTypeManager.get(SysExpansionFieldTypeEnum.ENCRYPT_TEXT);
        const attribute: IAttribute = {
            code: 'password',
            name: 'password',
            columnName: 'password',
            type: SysExpansionFieldTypeEnum.ENCRYPT_TEXT,
            primitiveType: SysFieldTypeEnum.TEXT,
        };

        const hash = field.toDB('password', db, attribute) as string;

        expect(hash).toMatch(/^\$SC\$1\$/);
        expect(db.encrypt.verifyHash('password', hash)).toBe(true);
        expect(field.fromDB(hash, db, attribute)).toBe(hash);
    });
});
