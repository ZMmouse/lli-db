import { Knex } from 'knex';
import { isPlainObject } from 'lodash';
import { typeUtil } from '../../utils/type-util';
import type { IHelperCtx, ISelect, IStateSelect } from '../../types/query';
import { toColumnName } from './transform';
import { LliDbError } from '../../error/lli-db-error';

type ISelectCtx = IHelperCtx & {
    alias: string;
};

// 处理字段名和别名
const parseFieldName = (field: string): { code: string; aliasCode: string } => {
    const parts = field.split(':');
    if (parts.length > 1) {
        return {
            code: parts[0],
            aliasCode: parts[1],
        };
    }
    return {
        code: field,
        aliasCode: field,
    };
};

export const buildSelect = (
    select: ISelect,
    { db, alias, qb, code }: ISelectCtx,
): IStateSelect[] => {
    const model = db.modelStore.get(code);
    const attributes = model.attributes;

    // 处理字符串类型的选择
    if (typeof select === 'string') {
        if (select === '*') {
            const arr: IStateSelect[] = [];

            for (const key of Object.keys(attributes)) {
                if (typeUtil.isMultiQuote(attributes[key])) {
                    continue;
                }

                arr.push({
                    fieldCode: key,
                    code: code,
                    aliasCode: key,
                    alias: alias,
                });
            }
            return arr;
        }

        if (!attributes) {
            LliDbError.throwModelNoAttribute(code);
        }
        const { code: fieldCode, aliasCode } = parseFieldName(select);
        return [
            {
                fieldCode,
                code: code,
                aliasCode,
                alias: alias,
            },
        ];
    }

    // 处理数组类型的选择
    if (Array.isArray(select)) {
        return select.flatMap((item) => buildSelect(item, { db, alias, qb, code }));
    }

    // 处理对象类型的选择
    if (isPlainObject(select)) {
        return Object.entries(select).flatMap(([key, value]) => {
            const attribute = attributes[key];

            if (!attribute) {
                LliDbError.throwModelAttributeNotFound(code, key);
            }

            // 首先判断值是否为字符串，如果是则作为别名
            if (typeof value === 'string') {
                return [
                    {
                        fieldCode: key,
                        code: code,
                        aliasCode: value,
                        alias,
                    },
                ];
            }

            // 其次判断是否为单选引用关系
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
                // 递归处理关联表的选择字段
                return buildSelect(Array.isArray(value) ? value : [value as string], {
                    db,
                    alias: refAlias,
                    qb,
                    code: attribute.refCode,
                });
            }

            // 如果既不是字符串也不是单选引用关系，则抛出类型错误
            LliDbError.throw500(`错误的select参数: "${key}".`);
        });
    }

    return [];
};

interface IApplySelectCtx extends IHelperCtx {
    query: Knex.QueryBuilder | Knex;
}

export const applySelect = (select: IStateSelect[], ctx: IApplySelectCtx) => {
    const { db, code, query } = ctx;

    // 如果没有指定 select，默认选择所有字段
    if (!select || select.length === 0) {
        query.select('*');
        return;
    }

    // 获取模型信息
    const model = db.modelStore.get(code);
    if (!model) {
        LliDbError.throwModelNotFound(code);
    }

    // 处理每个 select 项
    query.select(
        ...select.map((item) => {
            const { aliasCode, alias, code, fieldCode } = item;

            const model = db.modelStore.get(code);
            const columnName = toColumnName(model, fieldCode);

            return `${ctx.qb.aliasColumn(columnName, alias)} as ${aliasCode}`;
        }),
    );
};
