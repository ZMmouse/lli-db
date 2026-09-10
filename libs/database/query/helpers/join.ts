import { Knex } from 'knex';
import type { IHelperCtx, IStateJoin } from '../../types/query';
import { toColumnName } from './transform';

export interface IApplyJoinsCtx extends IHelperCtx {
    query: Knex.QueryBuilder;
}

export const applyJoins = (joins: IStateJoin[], ctx: IApplyJoinsCtx) => {
    const { query } = ctx;

    if (!joins?.length) {
        return;
    }

    joins.forEach(({ code, refAlias, alias, refCode, refFieldCode, fieldCode }) => {
        const model = ctx.db.modelStore.get(code);
        const columnName = toColumnName(model, fieldCode);

        const refModel = ctx.db.modelStore.get(refCode);
        const refColumnName = toColumnName(refModel, refFieldCode);

        query.leftJoin(
            `${refModel.tableName} as ${refAlias}`,
            ctx.qb.aliasColumn(refColumnName, refAlias),
            '=',
            ctx.qb.aliasColumn(columnName, alias),
        );
    });
};
