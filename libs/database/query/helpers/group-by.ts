import { Knex } from 'knex';
import type { IHelperCtx, IStateSelect } from '../../types/query';
import { toColumnName } from './transform';

export interface IApplyGroupByCtx extends IHelperCtx {
    query: Knex.QueryBuilder;
    alias: string;
}

export const applyGroupBy = (groupBy: string[], ctx: IApplyGroupByCtx) => {
    if (!groupBy?.length) return;

    const { code, alias, query, qb } = ctx;
    const model = ctx.db.modelStore.get(code);

    groupBy.forEach((fieldCode) => {
        const columnName = toColumnName(model, fieldCode);
        query.groupBy(qb.aliasColumn(columnName, alias));
    });
};

export const applyGroupByWithSelect = (select: IStateSelect[], ctx: IApplyGroupByCtx) => {
    if (!select?.length) return;

    const { code, alias, query, qb } = ctx;
    const model = ctx.db.modelStore.get(code);

    select.forEach((item) => {
        const columnName = toColumnName(model, item.fieldCode);
        query.groupBy(qb.aliasColumn(columnName, alias));
    });
};
