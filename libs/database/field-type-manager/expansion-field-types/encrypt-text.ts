import { IExpansionField } from '../../types/i-field';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';
import type { IAttribute } from '../../types/model';
import { IDatabase } from '../../types/database';

export const encrypt = (db: IDatabase, attr: IAttribute, text: string) => {
    if (!text) return null;
    const type = attr.expansionConfig?.type ?? 'scrypt';
    if (type === 'scrypt') {
        return db.encrypt.hash(text);
    }
    if (type === 'sha256') {
        return db.encrypt.sha256(text, attr.expansionConfig?.salt);
    }
    if (type !== 'aes-256-gcm' && type !== 'aes-256-cbc') {
        throw new Error(`Unsupported EncryptText type: ${type}`);
    }
    const { key, iv } = attr.expansionConfig ?? {};

    return db.encrypt.encrypt(text, key, iv);
};

export const decrypt = (db: IDatabase, attr: IAttribute, text: string) => {
    if (!text) {
        return '';
    }
    const type = attr.expansionConfig?.type ?? 'scrypt';
    if (type === 'scrypt' || type === 'sha256') {
        return text;
    }
    if (type !== 'aes-256-gcm' && type !== 'aes-256-cbc') {
        throw new Error(`Unsupported EncryptText type: ${type}`);
    }
    const { key, iv } = attr.expansionConfig ?? {};

    return db.encrypt.decrypt(text, key, iv);
};

export default {
    inherit: SysFieldTypeEnum.TEXT,
    name: SysExpansionFieldTypeEnum.ENCRYPT_TEXT,

    toDB(value: string, db: IDatabase, attr: IAttribute): string | null {
        return encrypt(db, attr, value);
    },

    fromDB(value: string, db: IDatabase, attr: IAttribute): string {
        if (
            attr.expansionConfig?.type === 'aes-256-gcm' ||
            attr.expansionConfig?.type === 'aes-256-cbc'
        ) {
            return decrypt(db, attr, value);
        }
        return value;
    },
} as IExpansionField;
