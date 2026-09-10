import { IExpansionField } from '../../types/i-field';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../../enum/field-type-enum';

export default {
    inherit: SysFieldTypeEnum.TEXT,
    name: SysExpansionFieldTypeEnum.BIG_TEXT,
} as IExpansionField;
