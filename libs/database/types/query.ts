import type { Knex } from 'knex';
import type { Database } from '../database';
import type { QueryBuilder } from '../query';

export interface IHelperCtx {
    code: string;
    qb: QueryBuilder;
    db: Database;
}

export type IOrderBy =
    | {
          [key: string]: 'asc' | 'desc' | IOrderBy;
      }
    | string
    | Array<IOrderBy>;

export type ISelectObject = {
    [key: string]: string | Array<string> | Array<{ [key: string]: string | Array<string> }>;
};

export type ISelect = string | ISelectObject | Array<ISelect>;

export type IOperator =
    | 'eq'
    | 'notEq'
    | 'gt'
    | 'notGt'
    | 'lt'
    | 'notLt'
    | 'egt'
    | 'notEgt'
    | 'elt'
    | 'notElt'
    | 'in'
    | 'notIn'
    | 'like'
    | 'notLike'
    | 'between'
    | 'notBetween'
    | 'isNull'
    | 'startsWith'
    | 'notStartsWith'
    | 'endsWith'
    | 'notEndsWith'
    | 'containsCaseSensitive';

export type ILogical = 'and' | 'or' | 'not';

export type IWhereObject = {
    [key: string]: any | { [key in IOperator]: any } | { [key in ILogical]: IWhere };
};

export type IWhere = IWhereObject | { [key in ILogical]: IWhere };

export type IPopulateObject = {
    orderBy?: IOrderBy;
    select?: ISelect;
    where?: IWhere;
    /** @deprecated Use `where` instead. */
    filters?: IWhere;
    populate?: IPopulate;
};

export type IPopulate =
    | string
    | Array<IPopulate>
    | { [key: string]: IPopulateObject | Array<ISelect> };

export interface IOptimisticMutationOptions {
    /** Expected record revision for an atomic optimistic update or delete. */
    expectedRevision?: number;
}

export interface IParams extends IOptimisticMutationOptions {
    where?: IWhere;
    /** @deprecated Use `where` instead. */
    filters?: IWhere;
    select?: ISelect;
    populate?: IPopulate;
    orderBy?: IOrderBy;
    groupBy?: string[];
    data?: Record<string, unknown> | Array<Record<string, unknown>>;
    page?: number;
    pageSize?: number;
    limit?: number;
    offset?: number;
    count?: boolean;
}

export interface ICursorOrder {
    field: string;
    direction: 'asc' | 'desc';
}

export interface ICursorPageParams {
    where?: IWhere;
    /** @deprecated Use `where` instead. */
    filters?: IWhere;
    orderBy: ICursorOrder[];
    limit?: number;
    after?: Record<string, string | number | boolean | null>;
}

export interface IUpdateManyParams extends IParams {
    /**
     * Explicitly allow updating every row matched by the model's built-in scope.
     * Required when neither `where` nor `filters` contains a condition.
     */
    allowAll?: boolean;
}

export interface IStateSelect {
    code: string;
    aliasCode: string;
    fieldCode: string;
    alias: string;
}

export interface IStateWhereCondition {
    code: string;
    fieldCode: string;
    alias: string;
    value?: any;
    operator?: IOperator;
    conditions?: Array<IStateWhere>;
}

export type IStateWhere =
    | {
          logical: ILogical;
          conditions: Array<IStateWhere | IStateWhereCondition>;
      }
    | IStateWhereCondition;

export interface IStateOrderBy {
    code: string;
    fieldCode: string;
    alias: string;
    order: 'asc' | 'desc';
}

export interface IStateJoin {
    code: string;
    fieldCode: string;
    alias: string;
    refCode: string;
    refFieldCode: string;
    refAlias: string;
}

export interface IStateSinglePopulate {
    code: string;
    fieldCode: string;
    refCode: string;
    refFieldCode: string;
    params: IParams;
}

export interface IStateMultiplePopulate extends IStateSinglePopulate {
    // 中间模型编码
    midCode: string;
    // 当前模型绑定字段在中间模型中的字段编码
    selfInMidFieldCode: string;
    // 关联模型绑定字段在中间模型中的字段编码
    refInMidFieldCode: string;
}

export type IStatePopulate = IStateSinglePopulate | IStateMultiplePopulate;

export interface IStatePopulateMap {
    [key: string]: IStatePopulate;
}

export interface IState {
    data: any;
    returning: null | '*' | string | string[];
    type: null | 'select' | 'update' | 'delete' | 'count' | 'insert' | 'min' | 'max';
    count: null | string;
    onConflict: any;
    ignore: null | boolean;
    limit: null | number;
    offset: null | number;
    page: null | number;
    pageSize: null | number;
    increments: Array<{ amount: number; fieldCode: string }>;
    decrements: Array<{ amount: number; fieldCode: string }>;
    merge: null | any;
    max: null | string;
    min: null | string;
    first: null | boolean;
    transaction: null | Knex.Transaction;
    select: IStateSelect[];
    where: IStateWhere[];
    orderBy: IStateOrderBy[];
    groupBy: string[];
    groupByWithSelect: boolean;
    joins: IStateJoin[];
    populate: null | IStatePopulateMap;
}
