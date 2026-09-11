import { isPlainObject, isEmpty } from 'lodash';
import { Knex } from 'knex';
import { typeUtil } from '../../utils/type-util';
import type {
    IHelperCtx,
    IStateWhere,
    IWhere,
    IOperator,
    ILogical,
    IStateWhereCondition,
} from '../../types/query';
import { toColumnName } from './transform';
import type { Relation } from '../../types/model';
import { LliDbError } from '../../error/lli-db-error';

interface IWhereCtx extends IHelperCtx {
    alias: string;
    key?: string;
}

const operators = [
    'eq',
    'notEq',
    'gt',
    'notGt',
    'lt',
    'notLt',
    'egt',
    'notEgt',
    'elt',
    'notElt',
    'in',
    'notIn',
    'like',
    'notLike',
    'between',
    'notBetween',
    'isNull',
    'startsWith',
    'notStartsWith',
    'endsWith',
    'notEndsWith',
    'containsCaseSensitive',
] as const;

const logicalKeys = ['and', 'or', 'not'] as const;

export const buildWhere = (where: IWhere, ctx: IWhereCtx): IStateWhere[] => {
    if (!where) return [];

    const conditions: IStateWhere[] = [];
    const entries = Object.entries(where);

    // 收集所有条件
    for (const [key, value] of entries) {
        conditions.push(buildCondition(key, ctx.key ?? key, value, ctx));
    }
    return conditions;
};

function checkIsLogical(value: any): value is ILogical {
    return logicalKeys.includes(value as ILogical);
}

function checkIsOperator(value: any): value is IOperator {
    return operators.includes(value as IOperator);
}

function buildLogical(logical: ILogical, value: any, ctx: IWhereCtx): IStateWhere {
    if (Array.isArray(value)) {
        return {
            logical,
            conditions: value.flatMap((item) => buildWhere(item, ctx)),
        };
    } else if (isPlainObject(value)) {
        return {
            logical,
            conditions: buildWhere(value, ctx),
        };
    }
    LliDbError.throw400(`错误的逻辑符号: ${JSON.stringify(value)}`);
}

// 验证运算符值的类型
function validateOperatorValue(operator: IOperator, value: any): void {
    switch (operator) {
        case 'between':
        case 'notBetween':
            if (!Array.isArray(value) || value.length !== 2) {
                LliDbError.throw400(`操作符 ${operator}的值类型错误: ${JSON.stringify(value)}`);
            }
            break;
        case 'in':
        case 'notIn':
            if (!Array.isArray(value)) {
                LliDbError.throw400(`操作符 ${operator} 的值类型错误: ${JSON.stringify(value)}`);
            }
            break;
        case 'isNull':
            if (typeof value !== 'boolean') {
                LliDbError.throw400(`操作符 ${operator} 的值类型错误: ${JSON.stringify(value)}`);
            }
            break;
        case 'like':
        case 'notLike':
        case 'startsWith':
        case 'notStartsWith':
        case 'endsWith':
        case 'notEndsWith':
        case 'containsCaseSensitive':
            if (typeof value !== 'string') {
                LliDbError.throw400(`操作符 ${operator} 的值类型错误: ${JSON.stringify(value)}`);
            }
            break;
    }
}

// 辅助函数：构建条件
function buildCondition(operator: string, key: string, value: any, ctx: IWhereCtx): IStateWhere {
    const { alias, code, db } = ctx;
    const model = db.modelStore.get(code);

    if (checkIsOperator(operator)) {
        if (Array.isArray(value) || !isPlainObject(value)) {
            // 验证运算符的值类型
            validateOperatorValue(operator, value);

            return {
                code: code,
                fieldCode: key,
                alias: alias,
                value,
                operator,
            };
        }
        LliDbError.throw400(`操作符 ${operator} 的值类型错误: ${JSON.stringify(value)}`);
    }

    if (checkIsLogical(operator)) {
        return buildLogical(operator, value, ctx);
    }

    const attribute = model.attributes[key];

    if (!attribute) {
        if (model.childCodes?.includes(key)) {
            return buildChildCondition(key, value, ctx);
        }
        return buildAttributeCondition(key, key, value, ctx);
    }

    if (typeUtil.isMultiQuote(attribute)) {
        return buildMultiQuoteCondition(operator, value, ctx);
    }

    if (Array.isArray(value)) {
        if (value.every((item) => !(Array.isArray(item) || isPlainObject(item)))) {
            return {
                code: code,
                fieldCode: operator,
                alias: alias,
                value,
                operator: 'in',
            };
        }
        LliDbError.throw400(`${key} 条件查询格式错误`);
    }

    if (typeUtil.isSingleQuote(attribute)) {
        return buildSingleQuoteCondition(operator, value, ctx);
    }

    // 如果值是对象，说明有特定的运算符或嵌套条件
    if (isPlainObject(value)) {
        return {
            code: code,
            fieldCode: key,
            alias: alias,
            conditions: buildWhere(value, {
                ...ctx,
                key,
            }),
        };
    }

    return {
        code: code,
        fieldCode: operator,
        alias: alias,
        value,
        operator: 'eq',
    };
}

const buildAttributeCondition = (
    operator: string,
    key: string,
    value: any,
    ctx: IWhereCtx,
): IStateWhere => {
    const { alias, code } = ctx;

    if (checkIsLogical(operator)) {
        if (Array.isArray(value)) {
            return {
                logical: operator,
                conditions: value.flatMap((item) => buildAttributeCondition(key, key, item, ctx)),
            };
        } else if (isPlainObject(value)) {
            return {
                logical: operator,
                conditions: Object.entries(value).flatMap(([k, v]) =>
                    buildAttributeCondition(k, key, v, ctx),
                ),
            };
        }
        LliDbError.throw400(`操作符 ${operator} 的值类型错误: ${JSON.stringify(value)}`);
    }

    if (checkIsOperator(operator)) {
        if (Array.isArray(value) || !isPlainObject(value)) {
            // 验证运算符的值类型
            validateOperatorValue(operator, value);

            return {
                code: code,
                fieldCode: key,
                alias: alias,
                value,
                operator,
            };
        }
        LliDbError.throw400(`操作符 ${operator} 的值类型错误: ${JSON.stringify(value)}`);
    }

    if (Array.isArray(value)) {
        if (value.every((item) => !(Array.isArray(item) || isPlainObject(item)))) {
            return {
                code: code,
                fieldCode: key,
                alias: alias,
                value,
                operator: 'in',
            };
        }
        LliDbError.throw400(`${key} 条件格式错误`);
    }

    if (isPlainObject(value)) {
        return {
            code: code,
            fieldCode: key,
            alias: alias,
            conditions: Object.entries(value).map(([k, v]) =>
                buildAttributeCondition(k, key, v, ctx),
            ),
        };
    }

    return {
        code: code,
        fieldCode: key,
        alias: alias,
        value,
        operator: 'eq',
    };
};

const buildSingleQuoteCondition = (key: string, value: any, ctx: IWhereCtx): IStateWhere => {
    const { code, alias, db, qb } = ctx;
    const model = db.modelStore.get(code);
    const attribute = model.attributes[key] as Relation.SingleQuote;

    if (!isPlainObject(value)) {
        return {
            code: code,
            fieldCode: key,
            alias: alias,
            value,
            operator: 'eq',
        };
    }

    const curAlias = qb.getAlias(key);

    const selfWhere: IWhere = {};
    const linkWhere: IWhere = {};

    for (const k of Object.keys(value)) {
        if (checkIsOperator(k)) {
            selfWhere[k] = value[k];
        } else {
            linkWhere[k] = value[k];
        }
    }

    if (!isEmpty(linkWhere)) {
        qb.join({
            code: code,
            alias: alias,
            fieldCode: key,
            refCode: attribute.refCode,
            refFieldCode: attribute.refFieldCode,
            refAlias: curAlias,
        });
    }

    return {
        code: code,
        fieldCode: key,
        alias: alias,
        conditions: [
            ...buildWhere(linkWhere, {
                ...ctx,
                key: key,
                alias: curAlias,
                code: attribute.refCode,
            }),
            ...buildWhere(selfWhere, {
                ...ctx,
                key: key,
            }),
        ],
    };
};

const buildCommonMultiQuoteCondition = (
    operator: IOperator,
    key: string,
    value: any,
    ctx: IWhereCtx,
): IStateWhere => {
    const { code, alias, db, qb } = ctx;
    const model = db.modelStore.get(code);
    const attribute = model.attributes[key] as Relation.MultiQuote;

    const curAlias = qb.getAlias(key);
    qb.join({
        code: code,
        alias: alias,
        fieldCode: 'id',
        refCode: attribute.midCode,
        refFieldCode: attribute.selfInMidFieldCode,
        refAlias: curAlias,
    });
    qb.groupByWithSelect();
    return {
        code: code,
        fieldCode: attribute.refInMidFieldCode,
        alias: curAlias,
        value,
        operator: operator,
    };
};

const buildMultiQuoteCondition = (key: string, value: any, ctx: IWhereCtx): IStateWhere => {
    const { code, alias, db, qb } = ctx;
    const model = db.modelStore.get(code);
    const attribute = model.attributes[key] as Relation.MultiQuote;

    const curAlias = qb.getAlias(key);

    if (Array.isArray(value)) {
        if (value.every((item) => !(Array.isArray(item) || isPlainObject(item)))) {
            buildCommonMultiQuoteCondition('in', key, value, ctx);
        }
        LliDbError.throw400(`${key} 条件格式错误`);
    }

    if (!isPlainObject(value)) {
        return buildCommonMultiQuoteCondition('eq', key, value, ctx);
    }

    const selfWhere: IWhere = {};
    const linkWhere: IWhere = {};

    for (const k of Object.keys(value)) {
        if (checkIsOperator(k)) {
            selfWhere[k] = value[k];
        } else {
            linkWhere[k] = value[k];
        }
    }

    if (!isEmpty(linkWhere)) {
        const midAlias = qb.getAlias();
        qb.groupByWithSelect();
        qb.join({
            code: code,
            alias: alias,
            fieldCode: 'id',
            refCode: attribute.midCode,
            refFieldCode: attribute.selfInMidFieldCode,
            refAlias: midAlias,
        }).join({
            code: attribute.midCode,
            alias: midAlias,
            fieldCode: attribute.refInMidFieldCode,
            refCode: attribute.refCode,
            refFieldCode: 'id',
            refAlias: curAlias,
        });
    }

    return {
        code: code,
        fieldCode: key,
        alias: alias,
        conditions: [
            ...buildWhere(linkWhere, {
                ...ctx,
                alias: curAlias,
                code: attribute.refCode,
            }),
        ],
    };
};

const buildChildCondition = (key: string, value: any, ctx: IWhereCtx): IStateWhere => {
    const { code, alias, qb, db } = ctx;

    const childModel = db.modelStore.get(key);

    if (!childModel) {
        LliDbError.throwModelNotFound(key);
    }

    if (!childModel.parentCode || childModel.parentCode !== code) {
        LliDbError.throwModelNotForChildCode(key, code);
    }

    const curAlias = qb.getAlias(key);

    if (value !== null && typeof value !== 'object' && typeof value !== 'string') {
        LliDbError.throw400(`${key} 类型错误`);
    }

    if (Array.isArray(value)) {
        if (value.every((item) => typeof item === 'string')) {
            value = {
                id: value,
            };
        } else {
            LliDbError.throw400(`${key} 类型错误`);
        }
    } else if (typeof value === 'string') {
        value = {
            id: value,
        };
    }

    qb.join({
        code: code,
        alias: alias,
        fieldCode: 'id',
        refCode: key,
        refFieldCode: childModel.parentRefFieldCode!,
        refAlias: curAlias,
    });

    return {
        code: code,
        fieldCode: key,
        alias: alias,
        conditions: [
            ...buildWhere(value, {
                ...ctx,
                alias: curAlias,
                code: key,
            }),
        ],
    };
};

export interface IApplyWhereCtx extends IHelperCtx {
    query: Knex.QueryBuilder;
    logical?: ILogical;
}

export const applyWhere = (where: IStateWhere[], ctx: IApplyWhereCtx) => {
    const { query } = ctx;

    where.forEach((item) => {
        if ('logical' in item) {
            switch (item.logical) {
                case 'not':
                    query.whereNot((queryBuilder) => {
                        applyWhere(item.conditions, { ...ctx, query: queryBuilder });
                    });
                    break;
                case 'and':
                    query.where((queryBuilder) => {
                        applyWhere(item.conditions, { ...ctx, query: queryBuilder });
                    });
                    break;
                case 'or':
                    query.orWhere((queryBuilder) => {
                        applyWhere(item.conditions, { ...ctx, query: queryBuilder, logical: 'or' });
                    });

                    break;
            }
        } else if (item.conditions) {
            applyWhere(item.conditions, ctx);
        } else if (ctx.logical === 'or') {
            applyOrWhereItem(item, ctx);
        } else {
            applyWhereItem(item, ctx);
        }
    });
};

const applyWhereItem = (item: IStateWhereCondition, ctx: IApplyWhereCtx) => {
    const { query, db } = ctx;
    const model = db.modelStore.get(item.code);
    const columnName = toColumnName(model, item.fieldCode);
    const columnNameAlias = ctx.qb.aliasColumn(columnName, item.alias);
    switch (item.operator) {
        case 'between':
            query.whereBetween(columnNameAlias, item.value);
            break;
        case 'notBetween':
            query.whereNotBetween(columnNameAlias, item.value);
            break;
        case 'in':
            query.whereIn(columnNameAlias, item.value);
            break;
        case 'notIn':
            query.whereNotIn(columnNameAlias, item.value);
            break;
        case 'isNull':
            if (item.value) {
                query.whereNull(columnNameAlias);
            } else {
                query.whereNotNull(columnNameAlias);
            }
            break;
        case 'like':
            query.whereLike(columnNameAlias, `%${item.value}%`);
            break;
        case 'notLike':
            query.whereNot(columnNameAlias, 'like', `%${item.value}%`);
            break;
        case 'startsWith':
            query.whereLike(columnNameAlias, `${item.value}%`);
            break;
        case 'notStartsWith':
            query.whereNot(columnNameAlias, 'like', `${item.value}%`);
            break;
        case 'endsWith':
            query.whereLike(columnNameAlias, `%${item.value}`);
            break;
        case 'notEndsWith':
            query.whereNot(columnNameAlias, 'like', `%${item.value}`);
            break;
        case 'containsCaseSensitive':
            query.whereRaw('instr(??, ?) > 0', [columnNameAlias, item.value]);
            break;
        case 'eq':
            query.where(columnNameAlias, item.value);
            break;
        case 'notEq':
            query.whereNot(columnNameAlias, item.value);
            break;
        case 'gt':
            query.where(columnNameAlias, '>', item.value);
            break;
        case 'notGt':
            query.whereNot(columnNameAlias, '>', item.value);
            break;
        case 'egt':
            query.where(columnNameAlias, '>=', item.value);
            break;
        case 'notEgt':
            query.whereNot(columnNameAlias, '>=', item.value);
            break;
        case 'lt':
            query.where(columnNameAlias, '<', item.value);
            break;
        case 'notLt':
            query.whereNot(columnNameAlias, '<', item.value);
            break;
        case 'elt':
            query.where(columnNameAlias, '<=', item.value);
            break;
        case 'notElt':
            query.whereNot(columnNameAlias, '<=', item.value);
            break;
    }
};

const applyOrWhereItem = (item: IStateWhereCondition, ctx: IApplyWhereCtx) => {
    const { query, db } = ctx;
    const model = db.modelStore.get(item.code);
    const columnName = toColumnName(model, item.fieldCode);
    const columnNameAlias = ctx.qb.aliasColumn(columnName, item.alias);
    switch (item.operator) {
        case 'between':
            query.orWhereBetween(columnNameAlias, item.value);
            break;
        case 'notBetween':
            query.orWhereNotBetween(columnNameAlias, item.value);
            break;
        case 'in':
            query.orWhereIn(columnNameAlias, item.value);
            break;
        case 'notIn':
            query.orWhereNotIn(columnNameAlias, item.value);
            break;
        case 'isNull':
            if (item.value) {
                query.orWhereNull(columnNameAlias);
            } else {
                query.orWhereNotNull(columnNameAlias);
            }
            break;
        case 'like':
            query.orWhereLike(columnNameAlias, `%${item.value}%`);
            break;
        case 'notLike':
            query.orWhereNot(columnNameAlias, 'like', `%${item.value}%`);
            break;
        case 'startsWith':
            query.orWhereLike(columnNameAlias, `${item.value}%`);
            break;
        case 'notStartsWith':
            query.orWhereNot(columnNameAlias, 'like', `${item.value}%`);
            break;
        case 'endsWith':
            query.orWhereLike(columnNameAlias, `%${item.value}`);
            break;
        case 'notEndsWith':
            query.orWhereNot(columnNameAlias, 'like', `%${item.value}`);
            break;
        case 'containsCaseSensitive':
            query.orWhereRaw('instr(??, ?) > 0', [columnNameAlias, item.value]);
            break;
        case 'eq':
            query.orWhere(columnNameAlias, item.value);
            break;
        case 'notEq':
            query.orWhereNot(columnNameAlias, item.value);
            break;
        case 'gt':
            query.orWhere(columnNameAlias, '>', item.value);
            break;
        case 'notGt':
            query.orWhereNot(columnNameAlias, '>', item.value);
            break;
        case 'egt':
            query.orWhere(columnNameAlias, '>=', item.value);
            break;
        case 'notEgt':
            query.orWhereNot(columnNameAlias, '>=', item.value);
            break;
        case 'lt':
            query.orWhere(columnNameAlias, '<', item.value);
            break;
        case 'notLt':
            query.orWhereNot(columnNameAlias, '<', item.value);
            break;
        case 'elt':
            query.orWhere(columnNameAlias, '<=', item.value);
            break;
        case 'notElt':
            query.orWhereNot(columnNameAlias, '<=', item.value);
            break;
    }
};
