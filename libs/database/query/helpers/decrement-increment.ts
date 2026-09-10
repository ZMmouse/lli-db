import { Knex } from 'knex';
import type { IHelperCtx } from '../../types/query';
import { toColumnName } from './transform';

interface IApplyIncrementsCtx extends IHelperCtx {
    query: Knex.QueryBuilder;
    alias: string;
}

export const applyIncrements = (
    increments: Array<{ amount: number; fieldCode: string }>,
    ctx: IApplyIncrementsCtx,
) => {
    const model = ctx.db.modelStore.get(ctx.code);
    const { query, alias, qb } = ctx;
    return increments.forEach(({ amount, fieldCode }) => {
        const columnName = toColumnName(model, fieldCode);
        return query.increment(qb.aliasColumn(columnName, alias), amount);
    });
};

export const applyDecrements = (
    increments: Array<{ amount: number; fieldCode: string }>,
    ctx: IApplyIncrementsCtx,
) => {
    const { query, db, alias, qb } = ctx;
    const model = db.modelStore.get(ctx.code);
    return increments.forEach(({ amount, fieldCode }) => {
        const columnName = toColumnName(model, fieldCode);
        return query.decrement(qb.aliasColumn(columnName, alias), amount);
    });
};
