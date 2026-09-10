import { isPlainObject } from 'lodash';
import { Knex } from 'knex';
import type { IHelperCtx, IOrderBy, IStateOrderBy } from '../../types/query';
import { toColumnName } from './transform';
import { typeUtil } from '../../utils';
import { LliDbError } from '../../error/lli-db-error';

type IOrderByCtx = IHelperCtx & {
    alias: string;
};
export const buildOrderBy = (
    orderBy: IOrderBy,
    { db, alias, qb, code }: IOrderByCtx,
): IStateOrderBy[] => {
    const model = db.modelStore.get(code);
    const attributes = model.attributes;

    // 处理字符串类型的排序
    if (typeof orderBy === 'string') {
        if (!attributes) {
            LliDbError.throwModelNoAttribute(code);
        }
        return [
            {
                fieldCode: orderBy,
                code: code,
                alias,
                order: 'asc',
            },
        ];
    }

    // 处理数组类型的排序
    if (Array.isArray(orderBy)) {
        return orderBy.flatMap((item) => buildOrderBy(item, { db, alias, qb, code }));
    }

    // 处理对象类型的排序
    if (isPlainObject(orderBy)) {
        return Object.entries(orderBy).flatMap(([key, value]) => {
            const attribute = attributes[key];

            if (!attribute) {
                LliDbError.throwModelAttributeNotFound(code, key);
            }

            // 处理单引用关系
            if (typeUtil.isSingleQuote(attribute)) {
                const refAlias = qb.getAlias(key);

                qb.join({
                    code: code,
                    alias: alias,
                    fieldCode: key,
                    refCode: attribute.refCode,
                    refFieldCode: attribute.refFieldCode,
                    refAlias: refAlias,
                });
                return buildOrderBy(value, {
                    db,
                    alias: refAlias,
                    qb,
                    code: attribute.refCode,
                });
            }

            // 处理嵌套排序
            if (typeof value === 'object') {
                return buildOrderBy(value, { db, alias, qb, code });
            }

            // 不允许其他类型的关系进行排序
            if (typeUtil.isMultiQuote(attribute)) {
                LliDbError.throw400(`不能对 ${attribute.type} 排序`);
            }
            return [
                {
                    fieldCode: key,
                    code: code,
                    alias: alias,
                    order: value === 'desc' ? 'desc' : 'asc',
                },
            ];
        });
    }

    return [];
};

interface IApplyOrderByCtx extends IHelperCtx {
    query: Knex.QueryBuilder;
}

export const applyOrderBy = (orderBys: IStateOrderBy[], ctx: IApplyOrderByCtx) => {
    orderBys.forEach(({ alias, fieldCode, code, order }) => {
        const model = ctx.db.modelStore.get(code);
        const columnName = toColumnName(model, fieldCode);
        ctx.query.orderBy(ctx.qb.aliasColumn(columnName, alias), order);
    });
};
