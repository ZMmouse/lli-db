import * as crypto from 'node:crypto';
import { LliDbError } from '../error/lli-db-error';
import type { Database } from '../database';

const LEGACY_ALGORITHM = 'aes-256-cbc';
const ALGORITHM = 'aes-256-gcm';
const ENCRYPT_PREFIX = '$EN$';
const GCM_PREFIX = '$EN$v2$';
const GCM_NONCE_LENGTH = 12;
const GCM_AUTH_TAG_LENGTH = 16;
const GCM_AAD = Buffer.from('llii-db:$EN$:v2');

const SCRYPT_PREFIX = '$SC$1$';
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_SALT_LENGTH = 16;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;

export class Encrypt {
    private readonly key?: Buffer;
    private readonly iv?: Buffer;
    private readonly salt: string;

    constructor(db: Database) {
        const { key, iv, salt = '' } = db.config.encrypt ?? {};
        this.key = key === undefined ? undefined : this.toBuffer(key);
        this.iv = iv === undefined ? undefined : this.toBuffer(iv);
        this.salt = salt;
    }

    private toBuffer(value: string | Buffer) {
        return Buffer.isBuffer(value) ? value : Buffer.from(value);
    }

    private getKey(key?: string | Buffer) {
        const resolvedKey = key === undefined ? this.key : this.toBuffer(key);
        if (!resolvedKey) {
            LliDbError.throw500(
                'Encryption key is required. Configure encrypt.key or expansionConfig.key.',
            );
        }
        if (resolvedKey.length !== 32) {
            LliDbError.throw500('Invalid encryption key length. Key must be 32 bytes.');
        }
        return resolvedKey;
    }

    private getLegacyIv(iv?: string | Buffer) {
        const resolvedIv = iv === undefined ? this.iv : this.toBuffer(iv);
        if (!resolvedIv) {
            LliDbError.throw500(
                'Encryption IV is required to decrypt legacy aes-256-cbc data. Configure encrypt.iv or expansionConfig.iv.',
            );
        }
        if (resolvedIv.length !== 16) {
            LliDbError.throw500(
                'Invalid encryption IV length. Legacy aes-256-cbc IV must be 16 bytes.',
            );
        }
        return resolvedIv;
    }

    private safeEqual(left: Buffer, right: Buffer) {
        return left.length === right.length && crypto.timingSafeEqual(left, right);
    }

    /** Legacy SHA-256 compatibility helper. Use hash() for new password hashes. */
    sha256(text: string, salt?: string): string {
        if (text.startsWith(ENCRYPT_PREFIX)) {
            return text;
        }
        return this.createLegacySha256(text, salt);
    }

    private createLegacySha256(text: string, salt?: string): string {
        if (!salt) {
            salt = this.salt;
        }
        const hash = crypto.createHash('sha256');
        hash.update(text + salt);
        return ENCRYPT_PREFIX + hash.digest('hex');
    }

    /** Verifies hashes produced by the legacy sha256() helper. */
    sha256Compare(text: string, hash: string, salt?: string): boolean {
        return this.safeEqual(Buffer.from(this.createLegacySha256(text, salt)), Buffer.from(hash));
    }

    /** Creates a versioned scrypt password hash with a random 16-byte salt. */
    hash(text: string): string {
        if (text.startsWith(SCRYPT_PREFIX) || text.startsWith(ENCRYPT_PREFIX)) {
            return text;
        }
        const salt = crypto.randomBytes(SCRYPT_SALT_LENGTH);
        const derivedKey = crypto.scryptSync(text, salt, SCRYPT_KEY_LENGTH, {
            cost: SCRYPT_COST,
            blockSize: SCRYPT_BLOCK_SIZE,
            parallelization: SCRYPT_PARALLELIZATION,
            maxmem: SCRYPT_MAX_MEMORY,
        });
        return [
            SCRYPT_PREFIX.slice(0, -1),
            SCRYPT_COST,
            SCRYPT_BLOCK_SIZE,
            SCRYPT_PARALLELIZATION,
            salt.toString('hex'),
            derivedKey.toString('hex'),
        ].join('$');
    }

    /** Verifies both current scrypt hashes and legacy SHA-256 hashes. */
    verifyHash(text: string, hash: string, legacySalt?: string): boolean {
        if (hash.startsWith(SCRYPT_PREFIX)) {
            return this.verifyScrypt(text, hash);
        }
        if (hash.startsWith(ENCRYPT_PREFIX)) {
            return this.sha256Compare(text, hash, legacySalt);
        }
        return false;
    }

    needsHashUpgrade(hash: string): boolean {
        return hash.startsWith(ENCRYPT_PREFIX) && !hash.startsWith(GCM_PREFIX);
    }

    private verifyScrypt(text: string, hash: string): boolean {
        const parts = hash.split('$');
        if (parts.length !== 8 || parts[1] !== 'SC' || parts[2] !== '1') {
            return false;
        }
        const cost = Number(parts[3]);
        const blockSize = Number(parts[4]);
        const parallelization = Number(parts[5]);
        const salt = Buffer.from(parts[6], 'hex');
        const expected = Buffer.from(parts[7], 'hex');
        if (
            cost !== SCRYPT_COST ||
            blockSize !== SCRYPT_BLOCK_SIZE ||
            parallelization !== SCRYPT_PARALLELIZATION ||
            salt.length !== SCRYPT_SALT_LENGTH ||
            expected.length !== SCRYPT_KEY_LENGTH ||
            salt.toString('hex') !== parts[6].toLowerCase() ||
            expected.toString('hex') !== parts[7].toLowerCase()
        ) {
            return false;
        }
        try {
            const actual = crypto.scryptSync(text, salt, expected.length, {
                cost,
                blockSize,
                parallelization,
                maxmem: SCRYPT_MAX_MEMORY,
            });
            return this.safeEqual(actual, expected);
        } catch {
            return false;
        }
    }

    /**
     * Encrypts new values with AES-256-GCM and a random nonce.
     * The third argument remains accepted for source compatibility but is only used when decrypting legacy data.
     */
    encrypt(text: string, key?: string | Buffer, _legacyIv?: string | Buffer): string {
        void _legacyIv;
        if (text.startsWith(ENCRYPT_PREFIX)) {
            return text;
        }
        const resolvedKey = this.getKey(key);
        const nonce = crypto.randomBytes(GCM_NONCE_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, resolvedKey, nonce, {
            authTagLength: GCM_AUTH_TAG_LENGTH,
        });
        cipher.setAAD(GCM_AAD);
        const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
        const authTag = cipher.getAuthTag();
        return `${GCM_PREFIX}${nonce.toString('hex')}$${authTag.toString('hex')}$${encrypted.toString('hex')}`;
    }

    /** Decrypts current GCM values, legacy CBC values, or passes through plain text. */
    decrypt(encryptedText: string, key?: string | Buffer, legacyIv?: string | Buffer): string {
        if (!encryptedText.startsWith(ENCRYPT_PREFIX)) {
            return encryptedText;
        }
        if (encryptedText.startsWith(GCM_PREFIX)) {
            return this.decryptGcm(encryptedText, key);
        }
        return this.decryptLegacy(encryptedText, key, legacyIv);
    }

    needsEncryptionUpgrade(encryptedText: string): boolean {
        return encryptedText.startsWith(ENCRYPT_PREFIX) && !encryptedText.startsWith(GCM_PREFIX);
    }

    upgradeEncryption(
        encryptedText: string,
        key?: string | Buffer,
        legacyIv?: string | Buffer,
    ): string {
        if (!this.needsEncryptionUpgrade(encryptedText)) {
            return encryptedText;
        }
        return this.encrypt(this.decryptLegacy(encryptedText, key, legacyIv), key);
    }

    private decryptGcm(encryptedText: string, key?: string | Buffer): string {
        const resolvedKey = this.getKey(key);
        try {
            const parts = encryptedText.substring(GCM_PREFIX.length).split('$');
            if (parts.length !== 3) {
                throw new Error('Invalid encrypted value format');
            }
            const [nonceHex, authTagHex, ciphertextHex] = parts;
            const nonce = Buffer.from(nonceHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            const ciphertext = Buffer.from(ciphertextHex, 'hex');
            if (
                nonce.length !== GCM_NONCE_LENGTH ||
                authTag.length !== GCM_AUTH_TAG_LENGTH ||
                nonce.toString('hex') !== nonceHex.toLowerCase() ||
                authTag.toString('hex') !== authTagHex.toLowerCase() ||
                ciphertext.toString('hex') !== ciphertextHex.toLowerCase()
            ) {
                throw new Error('Invalid encrypted value encoding');
            }
            const decipher = crypto.createDecipheriv(ALGORITHM, resolvedKey, nonce, {
                authTagLength: GCM_AUTH_TAG_LENGTH,
            });
            decipher.setAAD(GCM_AAD);
            decipher.setAuthTag(authTag);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
        } catch {
            LliDbError.throw500('Encrypted value authentication failed. The key or ciphertext is invalid.');
        }
    }

    private decryptLegacy(
        encryptedText: string,
        key?: string | Buffer,
        iv?: string | Buffer,
    ): string {
        const resolvedKey = this.getKey(key);
        const resolvedIv = this.getLegacyIv(iv);
        try {
            const ciphertext = encryptedText.substring(ENCRYPT_PREFIX.length);
            if (!ciphertext || !/^[a-f0-9]+$/i.test(ciphertext) || ciphertext.length % 2 !== 0) {
                throw new Error('Invalid legacy encrypted value format');
            }
            const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, resolvedKey, resolvedIv);
            return decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
        } catch {
            LliDbError.throw500(
                'Legacy encrypted value could not be decrypted. The key, IV, or ciphertext is invalid.',
            );
        }
    }
}
