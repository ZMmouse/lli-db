import { toString } from 'lodash';
import { IField } from '../../types/i-field';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export const MultiQuoteField: IField = {
    dbFiledType: DBFieldTypeEnum.VARCHAR,
    isColumn: false,
    name: SysFieldTypeEnum.MULTI_QUOTE,
    toDB(value: unknown): string {
        return toString(value);
    },
    fromDB(value: unknown): string {
        return toString(value);
    },
};
