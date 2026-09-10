import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../enum/field-type-enum';
import { IAnyObject } from './any-object';
import { IAction, IMiddlewareCtx } from '../middleware-manager/types';
import { IMiddleware } from './middleware';

export type IAttribute =
    | IScalarAttribute
    | RelationalAttribute
    | ISelectAttribute
    | ILimitedAttribute
    | IDecimalAttribute;

export interface IScalarAttribute extends IBaseAttribute {
    type: SysFieldTypeEnum | SysExpansionFieldTypeEnum | string;
}

export interface ISelectAttribute extends IBaseAttribute {
    type: SysExpansionFieldTypeEnum.SINGLE_SELECT | SysExpansionFieldTypeEnum.MULTI_SELECT;
    enum: string;
}

export interface ILimitedAttribute extends IScalarAttribute {
    type: SysFieldTypeEnum.INT | SysFieldTypeEnum.FLOAT | SysFieldTypeEnum.TEXT;
    min?: number;
    max?: number;
}

export interface IDecimalAttribute extends IScalarAttribute {
    type: SysFieldTypeEnum.FLOAT;
    precise: number;
}

export interface IBooleanAttribute extends IScalarAttribute {
    type: SysFieldTypeEnum.SWITCH;
    // 排他性
    isExclusive?: boolean;
}

export type RelationalAttribute = Relation.SingleQuote | Relation.MultiQuote;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Relation {
    export interface IBaseRelation extends IBaseAttribute {
        // 关联的模型编码
        refCode: string;
        // 关联关系的字段编码
        refFieldCode: string;
        // 关联模型显示的字段编码
        refDisplayCode: string;
        // 关联模型查询的字段编码
        refLinkQueryCodes?: string[];
    }

    export interface SingleQuote extends IBaseRelation {
        type: SysFieldTypeEnum.SINGLE_QUOTE;
    }
    export interface MultiQuote extends IBaseRelation {
        type: SysFieldTypeEnum.MULTI_QUOTE;
        // 中间模型编码
        midCode: string;
        // 当前模型绑定字段在中间模型中的字段编码
        selfInMidFieldCode: string;
        // 关联模型绑定字段在中间模型中的字段编码
        refInMidFieldCode: string;
    }
}

export interface IBaseAttribute {
    type: string;
    primitiveType?: SysFieldTypeEnum;
    code: string;
    columnName: string;
    name: string;
    default?: any;
    required?: boolean;
    unique?: boolean;
    length?: number;
    primary?: boolean;
    expansionConfig?: IAnyObject;
}

export interface IIndex {
    codes: string[];
    name: string;
    type?: 'primary' | 'unique';
}

export interface IBaseModel {
    parentCode?: string;
    parentRefFieldCode?: string;
    code: string;
    name: string;
    tableName: string;
    useCreatedFields?: boolean;
    useUpdatedFields?: boolean;
    useLogicDelete?: boolean;
    useEnabled?: boolean;
    useTree?: boolean;
}

export interface IModel extends IBaseModel {
    isLocal?: boolean;
    localTimeout?: number;
    childCodes?: string[];
    attributes: Record<string, IAttribute>;
    indexes?: IIndex[];
    middlewares?: Partial<Record<IAction, IMiddleware<IMiddlewareCtx>>>;
}

export interface IEntity extends IBaseModel {
    id: string;
    fields: IAttribute[];
}

export type IEntityAttribute = IAttribute & {
    id: string;
    entityCode: string;
};

export type IEntityIndex = IIndex & {
    id: string;
    entityCode: string;
};
