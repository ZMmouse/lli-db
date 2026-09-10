import { toString } from 'lodash';
import { IField } from '../../types/i-field';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export const LongTextField: IField = {
    dbFiledType: DBFieldTypeEnum.TEXT,
    name: SysFieldTypeEnum.LONG_TEXT,
    toDB(value: unknown): string {
        return toString(value);
    },
    fromDB(value: unknown): string {
        return toString(value);
    },
};
