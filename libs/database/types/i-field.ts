import { IAttribute } from './model';
import { DBFieldTypeEnum, SysFieldTypeEnum } from '../enum/field-type-enum';
import { IDatabase } from './database';
import { IMiddleware } from './middleware';
import { IAction, IMiddlewareCtx } from '../middleware-manager/types';

export interface IField {
    inherit?: SysFieldTypeEnum;
    name: string;
    dbFiledType: DBFieldTypeEnum;
    isColumn?: boolean;
    middlewares?: Partial<Record<IAction, IMiddleware<IMiddlewareCtx>>>;

    toDB(value: unknown, db: IDatabase, attr: IAttribute): unknown;
    fromDB(value: unknown, db: IDatabase, attr: IAttribute): unknown;

    validate?(value: unknown): void;
}

export type IExpansionField = Partial<IField> & {
    name: string;
    inherit: SysFieldTypeEnum;
};
