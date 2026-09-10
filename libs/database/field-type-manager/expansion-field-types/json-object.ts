import { IExpansionField } from '../../types/i-field';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export default {
    inherit: SysFieldTypeEnum.JSON,
    name: SysExpansionFieldTypeEnum.JSON_OBJECT,
} as IExpansionField;
