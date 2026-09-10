import { toNumber } from 'lodash';
import { LliDbError } from '../../error/lli-db-error';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';
import { IField } from '../../types/i-field';

export const FloatField: IField = {
    dbFiledType: DBFieldTypeEnum.FLOAT,
    name: SysFieldTypeEnum.FLOAT,
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
