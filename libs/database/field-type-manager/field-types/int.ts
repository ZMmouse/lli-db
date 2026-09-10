import { toNumber } from 'lodash';
import { LliDbError } from '../../error/lli-db-error';
import { IField } from '../../types/i-field';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export const IntField: IField = {
    dbFiledType: DBFieldTypeEnum.INT,
    name: SysFieldTypeEnum.INT,
    toDB(value: unknown): number {
        const newValue = toNumber(value);

        if (isNaN(newValue)) {
            LliDbError.throw400(`${value}必须是一个数字`);
        }

        return toNumber(value);
    },

    fromDB(value: unknown): number {
        return toNumber(value);
    },
};
