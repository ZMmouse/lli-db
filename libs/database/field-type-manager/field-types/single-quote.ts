import { toString } from 'lodash';
import { IField } from '../../types/i-field';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export const SingleQuoteField: IField = {
    dbFiledType: DBFieldTypeEnum.VARCHAR,
    name: SysFieldTypeEnum.SINGLE_QUOTE,
    toDB(value: unknown): string {
        return toString(value);
    },
    fromDB(value: unknown): string {
        return toString(value);
    },
};
