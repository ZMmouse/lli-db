import type { IAttribute, Relation } from '../types/model';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../enum/field-type-enum';

const NumberTypes: string[] = [SysFieldTypeEnum.INT, SysFieldTypeEnum.FLOAT];

const StringTypes: string[] = [SysFieldTypeEnum.TEXT, SysFieldTypeEnum.LONG_TEXT];

export const isQuote = (
    attribute: IAttribute,
): attribute is Relation.SingleQuote | Relation.MultiQuote => {
    const type = attribute.primitiveType || attribute.type;
    return type === SysFieldTypeEnum.SINGLE_QUOTE || type === SysFieldTypeEnum.MULTI_QUOTE;
};

export const isSingleQuote = (attribute: IAttribute): attribute is Relation.SingleQuote => {
    return (attribute.primitiveType || attribute.type) === SysFieldTypeEnum.SINGLE_QUOTE;
};

export const isMultiQuote = (attribute: IAttribute): attribute is Relation.MultiQuote => {
    return (attribute.primitiveType || attribute.type) === SysFieldTypeEnum.MULTI_QUOTE;
};
export const isString = (type: SysFieldTypeEnum | SysExpansionFieldTypeEnum | string) => {
    return StringTypes.includes(type);
};

export const isNumber = (type: string) => {
    return NumberTypes.includes(type);
};

export const typeUtil = {
    isQuote,
    isSingleQuote,
    isMultiQuote,
    isString,
    isNumber,
};
