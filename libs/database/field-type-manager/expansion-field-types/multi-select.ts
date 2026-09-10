import { IExpansionField } from '../../types/i-field';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';
import { LliDbError } from '../../error/lli-db-error';

export default {
    inherit: SysFieldTypeEnum.JSON,
    name: SysExpansionFieldTypeEnum.MULTI_SELECT,

    toDB(value: any) {
        if (!Array.isArray(value)) {
            LliDbError.throw400(`多选字段值必须是一个数组`);
        }
        return JSON.stringify(value);
    },
} as IExpansionField;
