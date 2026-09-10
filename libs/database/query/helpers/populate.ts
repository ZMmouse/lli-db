import { cloneDeep, isPlainObject } from 'lodash';
import type { Relation } from '../../types/model';
import type {
    IStatePopulateMap,
    IPopulate,
    IHelperCtx,
    IStateSinglePopulate,
    IStateMultiplePopulate,
    IStatePopulate,
} from '../../types/query';
import { typeUtil } from '../../utils/type-util';
import { toColumnName } from './transform';
import { toChildValueKey } from '../../entity-manager/transform';
import { LliDbError } from '../../error/lli-db-error';
import { splitIntoBatches, validateQueryConfig } from './limits';

const executePopulateBatches = async <T>(
    values: T[],
    ctx: IHelperCtx,
    execute: (batch: T[]) => Promise<any[]>,
) => {
    const { populateBatchSize } = validateQueryConfig(ctx.db.config.query);
    const result: any[] = [];
    for (const batch of splitIntoBatches(values, populateBatchSize)) {
        result.push(...(await execute(batch)));
    }
    return result;
};

export const buildPopulate = (populate: IPopulate, ctx: IHelperCtx): IStatePopulateMap => {
    if (!populate) {
        return {};
    }

    const { db, code } = ctx;

    const model = db.modelStore.get(code);

    if (!model) {
        LliDbError.throwModelNotFound(code);
    }

    if (Array.isArray(populate)) {
        return populate.reduce((map: IStatePopulateMap, item) => {
            return { ...map, ...buildPopulate(item, ctx) };
        }, {});
    }
    if (isPlainObject(populate)) {
        return Object.entries(populate).reduce((map: IStatePopulateMap, [key, value]) => {
            const attribute = model.attributes[key];

            if (Array.isArray(value)) {
                value = {
                    select: value,
                };
            }

            const statePopulate = {
                code,
                fieldCode: key,
                refCode: '',
                refFieldCode: '',
                params: cloneDeep({
                    select: value.select ?? '*',
                    orderBy: value.orderBy,
                    filters: value.filters,
                    populate: value.populate,
                    where: value.where,
                }),
            } as IStateSinglePopulate;

            if (attribute) {
                if (typeUtil.isQuote(attribute)) {
                    Object.assign(statePopulate, {
                        refFieldCode: attribute.refFieldCode,
                        refCode: attribute.refCode,
                    });
                }
                if (typeUtil.isMultiQuote(attribute)) {
                    Object.assign(statePopulate, {
                        midCode: attribute.midCode,
                        refInMidFieldCode: attribute.refInMidFieldCode,
                        selfInMidFieldCode: attribute.selfInMidFieldCode,
                    });
                }
                map[key] = statePopulate;
            } else if (model.childCodes && model.childCodes.includes(key)) {
                const childModel = db.modelStore.get(key);
                if (!childModel) {
                    LliDbError.throwModelNotFound(key);
                }
                if (childModel.parentCode !== code) {
                    LliDbError.throwModelNotForChildCode(key, code);
                }
                Object.assign(statePopulate, {
                    refCode: key,
                    refFieldCode: childModel.parentRefFieldCode,
                });
                map[key] = statePopulate;
            }
            return map;
        }, {});
    }
    // 处理字符串类型的 populate
    if (typeof populate === 'string') {
        // 如果是 '*'，返回所有关联字段
        if (populate === '*') {
            type RelationAttribute = [string, Relation.SingleQuote | Relation.MultiQuote];
            const relationFields = Object.entries(model.attributes).filter(
                (entry): entry is RelationAttribute => {
                    const [, attr] = entry;
                    return typeUtil.isQuote(attr);
                },
            );

            return relationFields.reduce((map: IStatePopulateMap, [key, attribute]) => {
                map[key] = {
                    code,
                    fieldCode: key,
                    refCode: attribute.refCode,
                    refFieldCode: attribute.refFieldCode,
                    params: {
                        select: '*',
                        populate: undefined,
                        orderBy: undefined,
                        filters: undefined,
                    },
                };

                if (typeUtil.isMultiQuote(attribute)) {
                    Object.assign(map[key], {
                        midCode: attribute.midCode,
                        refInMidFieldCode: attribute.refInMidFieldCode,
                        selfInMidFieldCode: attribute.selfInMidFieldCode,
                    });
                }

                return map;
            }, {});
        }

        const attribute = model.attributes[populate];
        if (!typeUtil.isQuote(attribute)) {
            // 报错 提示只有关联字段才支持联查
            LliDbError.throwAttrNotQuoteField(populate);
        }

        return {
            [populate]: {
                code,
                fieldCode: populate,
                refCode: attribute.refCode,
                refFieldCode: attribute.refFieldCode,
                params: {
                    select: '*',
                    populate: undefined,
                    orderBy: undefined,
                    filters: undefined,
                },
            },
        };
    }

    LliDbError.throw500(`错误的populate参数: ${JSON.stringify(populate)}`);
};

export const applyPopulate = async (rows: any[], populate: IStatePopulateMap, ctx: IHelperCtx) => {
    const { db } = ctx;

    if (isPlainObject(rows)) {
        rows = [rows];
    }

    if (!rows?.length || !populate) {
        return rows;
    }

    const model = db.modelStore.get(ctx.code);
    const attributes = model.attributes;

    // 遍历每个需要关联的字段
    for (const [fieldCode, populateItem] of Object.entries(populate)) {
        if (!attributes[fieldCode] && model.childCodes?.includes(fieldCode)) {
            await applyChildPopulate(rows, fieldCode, populateItem, ctx);
        } else if (typeUtil.isSingleQuote(attributes[fieldCode])) {
            await applySingleQuotePopulate(rows, fieldCode, populateItem, ctx);
        } else if (typeUtil.isMultiQuote(attributes[fieldCode])) {
            await applyMultiQuotePopulate(rows, fieldCode, populateItem, ctx);
        }
    }
    return rows;
};

const applySingleQuotePopulate = async (
    rows: any[],
    fieldCode: string,
    populate: IStatePopulate,
    ctx: IHelperCtx,
) => {
    const { refCode, refFieldCode, params } = populate;

    const values = [
        ...rows.reduce((set, row) => {
            if (row[fieldCode] !== null && row[fieldCode] !== undefined) {
                set.add(row[fieldCode]);
            }
            return set;
        }, new Set()),
    ];

    if (values.length === 0) {
        return;
    }

    const select =
        Array.isArray(params.select) && !params.select.includes(refFieldCode)
            ? [...params.select, refFieldCode]
            : params.select;

    const result = await executePopulateBatches(values, ctx, (batch) =>
        ctx.db
            .createQueryBuilder(refCode)
            .init({ ...params, select })
            .where({
                [refFieldCode]: {
                    in: batch,
                },
            })
            .execute(),
    );

    const map = result.reduce((map: Record<string, any>, row: any) => {
        if (!map[row[refFieldCode]]) {
            map[row[refFieldCode]] = [];
        }
        map[row[refFieldCode]].push(row);
        return map;
    }, {});

    rows.forEach((row) => {
        row[fieldCode] = map[row[fieldCode]] ? map[row[fieldCode]][0] : null;
    });
};

const applyChildPopulate = async (
    rows: any[],
    fieldCode: string,
    populate: IStatePopulate,
    ctx: IHelperCtx,
) => {
    const { refCode, refFieldCode, params } = populate;

    const values = [
        ...rows.reduce((set, row) => {
            if (row.id !== null && row.id !== undefined) {
                set.add(row.id);
            }
            return set;
        }, new Set()),
    ];

    if (values.length === 0) {
        return;
    }

    const select =
        Array.isArray(params.select) && !params.select.includes(refFieldCode)
            ? [...params.select, refFieldCode]
            : params.select;

    const result = await executePopulateBatches(values, ctx, (batch) =>
        ctx.db
            .createQueryBuilder(refCode)
            .init({ ...params, select })
            .where({
                [refFieldCode]: {
                    in: batch,
                },
            })
            .execute(),
    );

    const map = result.reduce((map: Record<string, any>, row: any) => {
        if (!map[row[refFieldCode]]) {
            map[row[refFieldCode]] = [];
        }
        map[row[refFieldCode]].push(row);
        return map;
    }, {});

    rows.forEach((row) => {
        row[toChildValueKey(fieldCode)] = map[row.id] ?? [];
    });
};

const bindIdKey = '__bid';
export const applyMultiQuotePopulate = async (
    rows: any[],
    fieldCode: string,
    populate: IStatePopulate,
    ctx: IHelperCtx,
) => {
    const { db } = ctx;

    const { code, params } = populate;
    const values = [...new Set(rows.map((row) => row.id))];

    if (values.length === 0) {
        return;
    }
    const { midCode, refInMidFieldCode, selfInMidFieldCode, refCode } =
        populate as IStateMultiplePopulate;
    const midModel = db.modelStore.get(midCode);
    const result = await executePopulateBatches(values, ctx, async (batch) => {
        const queryBuilder = db.createQueryBuilder(refCode);
        const midAlias = queryBuilder.getAlias();
        const selfAlias = queryBuilder.getAlias();
        const selfInMidColumnName = toColumnName(midModel, selfInMidFieldCode);
        const selectBindId = `${midAlias}.${selfInMidColumnName}:${bindIdKey}`;

        return queryBuilder
            .init({
                ...params,
                select: params.select ? [params.select, selectBindId] : ['*', selectBindId],
            })
            .join({
                code: refCode,
                alias: queryBuilder.alias,
                fieldCode: 'id',
                refFieldCode: refInMidFieldCode,
                refCode: midCode,
                refAlias: midAlias,
            })
            .join({
                code: midCode,
                alias: midAlias,
                fieldCode: selfInMidFieldCode,
                refFieldCode: 'id',
                refCode: code,
                refAlias: selfAlias,
            })
            .where({
                [`${selfAlias}.id`]: {
                    in: batch,
                },
            })
            .execute<any[]>();
    });
    const map = result.reduce((map: Record<string, any>, row: any) => {
        if (!map[row[bindIdKey]]) {
            map[row[bindIdKey]] = [];
        }
        map[row[bindIdKey]].push(row);
        return map;
    }, {});

    rows.forEach((row) => {
        row[fieldCode] = map[row.id] || [];
    });
};
