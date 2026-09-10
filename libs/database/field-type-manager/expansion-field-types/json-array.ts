import { IExpansionField } from '../../types/i-field';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';
import { LliDbError } from '../../error/lli-db-error';

export default {
    inherit: SysFieldTypeEnum.JSON,
    name: SysExpansionFieldTypeEnum.JSON_ARRAY,

    toDB(value: any) {
        if (Array.isArray(value)) {
            return JSON.stringify(value);
        }
        LliDbError.throw400(`错误的JSON数组: ${JSON.stringify(value)}`);
    },
} as IExpansionField;
