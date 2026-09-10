import { toString } from 'lodash';
import { IField } from '../../types/i-field';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

const isStringOrNumber = (value: unknown): value is string | number => {
    return typeof value === 'string' || typeof value === 'number';
};

export const SwitchField: IField = {
    name: SysFieldTypeEnum.SWITCH,
    dbFiledType: DBFieldTypeEnum.BOOLEAN,
    toDB(value: unknown): unknown {
        if (typeof value === 'boolean') return value;

        if (isStringOrNumber(value) && ['true', 't', '1', 1].includes(value)) return true;
        if (isStringOrNumber(value) && ['false', 'f', '0', 0].includes(value)) return false;

        return Boolean(value);
    },
    fromDB(value: unknown): unknown {
        if (typeof value === 'boolean') return value;
        const str = toString(value);
        if (str === '1') {
            return true;
        }

        if (str === '0') {
            return false;
        }
        return null;
    },
};
