import { isEmpty, isPlainObject, pick } from 'lodash';
import { Knex } from 'knex';
import type { Database } from '../database';
import { QueryBuilder } from '../query';
import type { IMutationParams, IParams, ISelect, IUpdateManyParams } from '../types/query';
import { hasWhereConditions, normalizeQueryParams } from '../query/helpers/normalize-params';
import { processData } from './process-data';
import { EntityRepository } from './entity-repository';
import { IAnyObject } from '../types/any-object';
import { IPageResult, IUpdateManyResult } from '../types/i-result';
import { LliDbError } from '../error/lli-db-error';
import { DeletePlanner } from './delete-planner';
import { RelationWriter } from './relation-writer';
import { ChildWriter } from './child-writer';
import type { ICursorPageParams } from '../types/query';
import type { ICursorPageResult } from '../types/i-result';
import { findCursorPage } from './cursor-page';
import { SysExpansionFieldTypeEnum } from '../enum/field-type-enum';
import type { IModel } from '../types/model';

const hasRevisionField = (model: IModel) =>
    model.attributes.revision?.type === SysExpansionFieldTypeEnum.REVISION;

const getExpectedRevisionId = (code: string, model: IModel, params: IMutationParams) => {
    if (params.expectedRevision === undefined) return undefined;
    if (!hasRevisionField(model)) {
        throw new LliDbError(`Model ${code} does not enable revision`, 'LLI400');
    }
    if (!Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 1) {
        throw new LliDbError('expectedRevision must be a positive safe integer', 'LLI40020', {
            modelCode: code,
            fieldCode: 'revision',
            reason: 'expected a positive safe integer',
        });
    }
    const where = params.where;
    const id = isPlainObject(where) ? (where as Record<string, unknown>).id : undefined;
    const whereRecord = where as Record<string, unknown>;
    const logicDeleteScope = whereRecord?.deleted;
    const logicDeleteCondition = logicDeleteScope as Record<string, unknown>;
    const hasValidLogicDeleteScope =
        model.useLogicDelete === true &&
        isPlainObject(logicDeleteScope) &&
        Object.keys(logicDeleteCondition).length === 1 &&
        logicDeleteCondition.notEq === true;
    const allowedKeyCount = hasValidLogicDeleteScope ? 2 : 1;
    if (
        typeof id !== 'string' ||
        id.length === 0 ||
        Object.keys(where as object).length !== allowedKeyCount
    ) {
        throw new LliDbError(
            'expectedRevision requires where to contain only a scalar id',
            'LLI400',
            {
                modelCode: code,
            },
        );
    }
    return id;
};

const throwRevisionConflict = (db: Database, code: string, expectedRevision: number): never => {
    db.diagnostics.emit({
        type: 'revision:conflict',
        modelCode: code,
        operation: 'compare-and-swap',
    });
    throw new LliDbError('Optimistic revision conflict', 'LLI40901', {
        modelCode: code,
        fieldCode: 'revision',
        expectedRevision,
    });
};

// 创建select
export const createDeleteSelect = (select: ISelect) => {
    if (Array.isArray(select)) {
        return ['id', ...select];
    }
    if (select) {
        return ['id', select];
    }
    return ['*'];
};

export class EntityManager {
    private readonly db: Database;
    private readonly repoMap: Record<string, EntityRepository<unknown>> = {};
    private readonly deletePlanner: DeletePlanner;
    private readonly relationWriter: RelationWriter;
    private readonly childWriter: ChildWriter;
    constructor(db: Database) {
        this.db = db;
        this.deletePlanner = new DeletePlanner(db);
        this.relationWriter = new RelationWriter(db);
        this.childWriter = new ChildWriter(db, this.relationWriter, this.deletePlanner);
    }

    createQueryBuilder(code: string) {
        return new QueryBuilder(this.db, code);
    }

    getRepository<T = IAnyObject>(code: string) {
        if (!this.repoMap[code]) {
            this.repoMap[code] = new EntityRepository<T>(this.db, code);
        }

        return this.repoMap[code] as EntityRepository<T>;
    }

    async findOne<T = IAnyObject>(code: string, params: IParams): Promise<T | null> {
        return this.db.middlewareManager.run('findOne', code, params, async (ctx) => {
            ctx.result = await this.createQueryBuilder(code).init(ctx.params).first().execute();
        });
    }

    async findMany<T = IAnyObject>(code: string, params: IParams): Promise<T[]> {
        return this.db.middlewareManager.run('findMany', code, params, async (ctx) => {
            ctx.result = await this.createQueryBuilder(code).init(ctx.params).execute();
        });
    }

    async queryPage<T = IAnyObject>(code: string, params: IParams): Promise<IPageResult<T>> {
        return this.db.middlewareManager.run('queryPage', code, params, async (ctx) => {
            const rows = await this.createQueryBuilder(code).init(ctx.params).execute();
            const total = await this.createQueryBuilder(code)
                .init({
                    ...params,
                    limit: undefined,
                    offset: undefined,
                    page: undefined,
                    pageSize: undefined,
                    orderBy: undefined,
                })
                .select('id')
                .count('id')
                .execute();
            ctx.result = {
                rows,
                total: Number(total[0].count),
            };
        });
    }

    async count(code: string, params: IParams, fieldCode: string = 'id') {
        return this.db.middlewareManager.run('count', code, params, async (ctx) => {
            const res = await this.createQueryBuilder(code)
                .init(pick(ctx.params, ['where', 'filters']))
                .count(fieldCode)
                .execute<Array<{ count: string }>>();
            ctx.result = Number(res[0]?.count ?? 0);
        });
    }

    async max(code: string, fieldCode: string = 'id', params: IParams) {
        return this.db.middlewareManager.run('max', code, params, async (ctx) => {
            const res = await this.createQueryBuilder(code)
                .init(pick(ctx.params, ['where', 'filters']))
                .max(fieldCode)
                .execute<Array<{ max: string }>>();
            ctx.result = Number(res[0]?.max ?? 0);
        });
    }

    async min(code: string, fieldCode: string = 'id', params: IParams) {
        return this.db.middlewareManager.run('min', code, params, async (ctx) => {
            const res = await this.createQueryBuilder(code)
                .init(pick(ctx.params, ['where', 'filters']))
                .min(fieldCode)
                .execute<Array<{ min: string }>>();
            ctx.result = Number(res[0]?.min ?? 0);
        });
    }

    async create<T = IAnyObject>(code: string, params: IParams): Promise<T> {
        return this.db.middlewareManager.run('create', code, params, async (ctx) => {
            const model = this.db.modelStore.get(code);
            const { data } = ctx.params;

            if (!isPlainObject(data)) {
                LliDbError.throw400('data必须是一个对象');
            }

            const newData = processData(this.db, data, model, { withDefaults: true });
            await this.db.transaction(async ({ trx }) => {
                await this.createQueryBuilder(code)
                    .insert(newData)
                    .transacting(trx)
                    .execute<Array<string | { id: string }>>();

                if (this.checkHasRelations(data, code) || this.checkHasChild(data, code)) {
                    await this.createRelations(code, [data], { transaction: trx });
                    await this.createChild(code, data, { transaction: trx });
                }
            });

            ctx.result = await this.findOne(code, {
                where: { id: data.id },
                select: ctx.params.select,
                populate: ctx.params.populate,
            });
        });
    }

    async createMany<T = IAnyObject>(code: string, params: IParams): Promise<T[]> {
        return this.db.middlewareManager.run('createMany', code, params, async (ctx) => {
            const model = this.db.modelStore.get(code);
            const { data: list } = ctx.params;
            if (!Array.isArray(list)) {
                LliDbError.throw400('data必须是一个数组');
            }

            const newData = list.map((item) =>
                processData(this.db, item, model, { withDefaults: true }),
            );

            if (isEmpty(newData)) {
                ctx.result = [];
                return;
            }
            const ids = list.map((row) => row.id);

            await this.db.transaction(async ({ trx }) => {
                await this.createQueryBuilder(code).insert(newData).transacting(trx).execute();
                await this.createRelations(code, list, { transaction: trx });
                await this.createChildMany(code, list, { transaction: trx });
            });

            ctx.result = await this.findMany(code, {
                where: { id: { in: ids } },
                select: ctx.params.select,
                populate: ctx.params.populate,
            });
        });
    }

    async update<T = IAnyObject>(code: string, params: IMutationParams): Promise<T | null> {
        return this.db.middlewareManager.run('update', code, params, async (ctx) => {
            const model = this.db.modelStore.get(code);

            const { where, data } = ctx.params;
            const expectedRevisionId = getExpectedRevisionId(code, model, ctx.params);

            if (!isPlainObject(data)) {
                LliDbError.throw400('data必须是一个对象');
            }
            if (isEmpty(where)) {
                LliDbError.throw400('更新数据时where不能为空');
            }

            const updateData = processData(this.db, data, model);

            if (isEmpty(updateData) && !hasRevisionField(model)) {
                ctx.result = null;
                return;
            }
            return this.db.transaction(async ({ trx }) => {
                const row =
                    expectedRevisionId === undefined
                        ? await this.createQueryBuilder(code)
                              .select('*')
                              .where(where)
                              .first()
                              .transacting(trx)
                              .execute()
                        : { id: expectedRevisionId };
                if (!row || isEmpty(row)) {
                    ctx.result = null;
                    return;
                }

                const writeWhere: IAnyObject = { id: row.id };
                if (model.useLogicDelete) {
                    writeWhere.deleted = { notEq: true };
                }
                if (ctx.params.expectedRevision !== undefined) {
                    writeWhere.revision = ctx.params.expectedRevision;
                }
                let query = this.createQueryBuilder(code).where(writeWhere).transacting(trx);
                if (!isEmpty(updateData)) {
                    query = query.update(updateData);
                }
                if (hasRevisionField(model)) {
                    query = query.increment('revision');
                }
                const updatedRows = await query.returning('*').execute<IAnyObject[]>();
                const updateCount = updatedRows.length;
                if (ctx.params.expectedRevision !== undefined && updateCount !== 1) {
                    throwRevisionConflict(this.db, code, ctx.params.expectedRevision);
                }

                await this.createRelations(
                    code,
                    [
                        {
                            ...data,
                            id: row.id,
                        },
                    ],
                    { transaction: trx },
                );
                await this.createChild(
                    code,
                    {
                        ...data,
                        id: row.id,
                    },
                    { transaction: trx },
                );

                ctx.result =
                    ctx.params.select || ctx.params.populate
                        ? await this.findOne(code, {
                              where: { id: row.id },
                              select: ctx.params.select,
                              populate: ctx.params.populate,
                          })
                        : (updatedRows[0] ?? null);
            });
        });
    }

    async updateMany(code: string, params: IUpdateManyParams): Promise<IUpdateManyResult> {
        const normalizedParams = normalizeQueryParams(params);
        if (!hasWhereConditions(normalizedParams.where) && params.allowAll !== true) {
            LliDbError.throw400('批量更新必须提供where，更新全表时请显式设置allowAll为true');
        }

        return this.db.middlewareManager.run('updateMany', code, params, async (ctx) => {
            const { where, data } = ctx.params;
            const model = this.db.modelStore.get(code);

            if (!isPlainObject(data)) {
                LliDbError.throw400('data必须是一个对象');
            }

            const updateData = processData(this.db, data, model);
            if (isEmpty(updateData)) {
                return { count: 0, updateIds: [] };
            }

            return this.db.transaction(async ({ trx }) => {
                const rows = await this.createQueryBuilder(code)
                    .select('*')
                    .where(where)
                    .transacting(trx)
                    .execute();
                const ids = rows.map((row: any) => row.id);

                const updateCount = await this.createQueryBuilder(code)
                    .update(updateData)
                    .where({
                        id: { in: ids },
                    })
                    .transacting(trx)
                    .execute<number>();

                const result = { count: updateCount, updateIds: ids };
                await this.createRelations(
                    code,
                    rows.map((item: IAnyObject) => {
                        return {
                            ...data,
                            id: item.id,
                        };
                    }),
                    { transaction: trx },
                );
                ctx.result = result;
                return result;
            });
        });
    }

    async clone<T = IAnyObject>(
        code: string,
        cloneId: string,
        params: IParams & { cloneChild?: boolean } = {},
    ): Promise<T> {
        const row = await this.createQueryBuilder(code)
            .select('*')
            .where({
                id: cloneId,
            })
            .first()
            .execute();

        if (!row) {
            LliDbError.throw400(`id为${cloneId}的数据不存在`);
        }

        const data = params.data ? { ...row, ...params.data } : { ...row };
        return this.create(code, {
            data,
        });
    }

    enabled(code: string, id: string) {
        const model = this.db.modelStore.get(code);
        if (!model) {
            LliDbError.throwModelNotFound(code);
        }
        if (model.useEnabled) {
            return this.update(code, {
                data: {
                    enabled: true,
                    enabledAt: new Date(),
                },
                where: {
                    id,
                },
            });
        }
        LliDbError.throw500(`模型 ${code} 未开启启用功能`);
    }

    unenabled(code: string, id: string) {
        const model = this.db.modelStore.get(code);
        if (!model) {
            LliDbError.throwModelNotFound(code);
        }
        if (model.useEnabled) {
            return this.update(code, {
                data: {
                    enabled: false,
                    enabledAt: new Date(),
                },
                where: {
                    id,
                },
            });
        }
        LliDbError.throw500(`模型 ${code} 未开启启用功能`);
    }

    checkUseLogicDelete(code: string) {
        return this.deletePlanner.checkUseLogicDelete(code);
    }

    async delete(code: string, params: IMutationParams): Promise<number> {
        return this.db.middlewareManager.run('delete', code, params, async (ctx) => {
            const { where, select, populate } = ctx.params;
            const model = this.db.modelStore.get(code);
            const expectedRevisionId = getExpectedRevisionId(code, model, ctx.params);

            if (isEmpty(where)) {
                LliDbError.throw400('删除数据时where不能为空');
            }

            return this.db.transaction(async ({ trx }) => {
                if (expectedRevisionId !== undefined) {
                    const deleteWhere: IAnyObject = {
                        id: expectedRevisionId,
                        revision: ctx.params.expectedRevision,
                    };
                    if (model.useLogicDelete) deleteWhere.deleted = { notEq: true };
                    let query = this.createQueryBuilder(code).where(deleteWhere).transacting(trx);
                    if (model.useLogicDelete) {
                        query = query
                            .update({ deleted: true, deletedAt: new Date() })
                            .increment('revision');
                    } else {
                        query = query.delete();
                    }
                    const res = await query.execute<number>();
                    if (res !== 1) {
                        throwRevisionConflict(this.db, code, ctx.params.expectedRevision);
                    }
                    await this.deleteRelations(code, [expectedRevisionId], { transaction: trx });
                    await this.deleteChildMany(code, [expectedRevisionId], { transaction: trx });
                    ctx.result = res;
                    return;
                }
                const row = await this.createQueryBuilder(code)
                    .init({
                        where,
                        select: createDeleteSelect(select),
                        populate,
                    })
                    .first()
                    .transacting(trx)
                    .execute();

                if (!row) {
                    ctx.result = 0;
                    return;
                }

                const res = await this._onHandlerDelete(code, [row.id], 'id', trx);
                await this.deleteRelations(code, [row.id], { transaction: trx });
                await this.deleteChildMany(code, [row.id], { transaction: trx });
                ctx.result = res;
            });
        });
    }

    async deleteMany(code: string, params: IParams) {
        return this.db.middlewareManager.run('deleteMany', code, params, async (ctx) => {
            const { where } = ctx.params;

            if (isEmpty(where)) {
                LliDbError.throw400('删除数据时where不能为空');
            }

            return this.db.transaction(async ({ trx }) => {
                const rows = await this.createQueryBuilder(code)
                    .where(where)
                    .transacting(trx)
                    .execute();

                if (rows.length === 0) {
                    ctx.result = [];
                    return;
                }

                const ids = rows.map((row: any) => row.id);
                const res = await this._onHandlerDelete(code, ids, 'id', trx);
                await this.deleteRelations(code, ids, { transaction: trx });
                await this.deleteChildMany(code, ids, { transaction: trx });
                ctx.result = res;
            });
        });
    }

    checkHasRelations(data: IAnyObject, code: string) {
        return this.relationWriter.hasRelations(data, code);
    }

    async createRelations(
        code: string,
        data: Array<Record<string, unknown>>,
        { transaction }: { transaction: Knex.Transaction },
    ) {
        return this.relationWriter.create(code, data, transaction);
    }

    checkHasChild(data: IAnyObject, code: string) {
        return this.childWriter.hasChild(data, code);
    }

    async createChild(
        code: string,
        data: Record<string, unknown>,
        { transaction }: { transaction: Knex.Transaction },
    ) {
        return this.childWriter.create(code, data, transaction);
    }

    _onHandlerDelete(code: string, ids: Array<string>, fieldCode = 'id', trx?: Knex.Transaction) {
        return this.deletePlanner.deleteRows(code, ids, fieldCode, trx);
    }

    async deleteRelations(
        code: string,
        ids: Array<string>,
        { transaction }: { transaction: Knex.Transaction },
    ) {
        return this.deletePlanner.deleteRelations(code, ids, transaction);
    }

    async deleteChildMany(
        code: string,
        ids: Array<string>,
        { transaction }: { transaction: Knex.Transaction },
    ) {
        return this.deletePlanner.deleteChildMany(code, ids, transaction);
    }

    findCursorPage<T = IAnyObject>(
        code: string,
        params: ICursorPageParams,
    ): Promise<ICursorPageResult<T>> {
        return this.db.runOperation(() => findCursorPage<T>(this.db, code, params));
    }

    async createChildMany(
        code: string,
        list: Array<Record<string, unknown>>,
        { transaction }: { transaction: Knex.Transaction },
    ) {
        return this.childWriter.createMany(code, list, transaction);
    }

    async cloneRelations(
        code: string,
        cloneId: string,
        data: IAnyObject,
        {
            transaction,
        }: {
            transaction: Knex.Transaction;
        },
    ) {
        return this.relationWriter.clone(code, cloneId, data, transaction);
    }

    private async cloneChild(
        code: string,
        cloneId: string,
        data: IAnyObject,
        {
            transaction,
        }: {
            transaction: Knex.Transaction;
        },
    ) {
        return this.childWriter.clone(code, cloneId, data, transaction);
    }
}
