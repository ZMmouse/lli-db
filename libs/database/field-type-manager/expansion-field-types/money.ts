import { isNil } from 'lodash';
import { IExpansionField } from '../../types/i-field';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export default {
    inherit: SysFieldTypeEnum.INT,
    name: SysExpansionFieldTypeEnum.MONEY,

    toDB(value: number) {
        if (isNil(value)) {
            return null;
        }
        return Number(value) * 1000;
    },
    fromDB(value: number) {
        if (isNil(value)) {
            return 0;
        }
        return Number(value) / 1000;
    },
} as IExpansionField;
