import type { Knex } from 'knex';
import type { Database } from '../database';
import { LliDbError } from '../error/lli-db-error';
import { QueryBuilder } from '../query';
import type { IAnyObject } from '../types/any-object';
import type { IRow } from '../types/i-row';
import type { IWhere } from '../types/query';
import { DeletePlanner } from './delete-planner';
import { processData } from './process-data';
import { RelationWriter } from './relation-writer';
import { toChildValueKey } from './transform';
import { checkIsDelete } from './utils';

const checkIsUpdate = (data: IAnyObject) => data.__op === 'update';

export class ChildWriter {
    constructor(
        private readonly db: Database,
        private readonly relationWriter: RelationWriter,
        private readonly deletePlanner: DeletePlanner,
    ) {}

    private createQueryBuilder(code: string) {
        return new QueryBuilder(this.db, code);
    }

    private async deleteChildren(
        childCode: string,
        parentRefFieldCode: string,
        requests: Array<{ id: string; parentId: string }>,
        transaction: Knex.Transaction,
    ) {
        if (requests.length === 0) return;
        const childModel = this.db.modelStore.get(childCode);
        const conditions = requests.map(({ id, parentId }) => ({
            id,
            [parentRefFieldCode]: parentId,
            ...(childModel.useLogicDelete ? { deleted: { notEq: true } } : {}),
        }));
        const where: IWhere = conditions.length === 1 ? conditions[0] : { or: conditions };
        const rows = await this.createQueryBuilder(childCode)
            .select('id')
            .where(where)
            .transacting(transaction)
            .execute<Array<Record<'id', string>>>();
        const deleteIds = [...new Set(rows.map((row) => row.id))];
        if (deleteIds.length === 0) return;

        await this.deletePlanner.deleteRows(childCode, deleteIds, 'id', transaction);
        await this.deletePlanner.deleteRelations(childCode, deleteIds, transaction);
        await this.deletePlanner.deleteChildMany(childCode, deleteIds, transaction);
    }

    private async writeChildren(
        childCode: string,
        parentRefFieldCode: string,
        operationData: IRow[],
        transaction: Knex.Transaction,
    ) {
        if (operationData.length === 0) return;
        const childModel = this.db.modelStore.get(childCode);
        const createData = operationData.filter((item) => !checkIsUpdate(item));
        const updateData = operationData.filter(checkIsUpdate);

        if (createData.length) {
            const rows = createData.map((item) =>
                processData(this.db, item, childModel, { withDefaults: true }),
            );
            await this.createQueryBuilder(childCode)
                .insert(rows)
                .returning('id')
                .transacting(transaction)
                .execute();
        }

        for (const item of updateData) {
            const where: IWhere = {
                id: item.id,
                [parentRefFieldCode]: item[parentRefFieldCode],
                ...(childModel.useLogicDelete ? { deleted: { notEq: true } } : {}),
            };
            const existing = await this.createQueryBuilder(childCode)
                .select('id')
                .where(where)
                .first()
                .transacting(transaction)
                .execute<IRow | undefined>();
            if (!existing) {
                throw new LliDbError(
                    `Child ${childCode} does not belong to the requested parent`,
                    'LLI40020',
                    { childCode, childId: item.id, parentId: item[parentRefFieldCode] },
                );
            }

            const row = processData(this.db, item, childModel);
            delete row.id;
            delete row[parentRefFieldCode];
            let query = this.createQueryBuilder(childCode).where(where).transacting(transaction);
            if (Object.keys(row).length) query = query.update(row);
            if (childModel.useRevision) query = query.increment('revision');
            if (Object.keys(row).length || childModel.useRevision) {
                await query.execute();
            }
        }

        await this.relationWriter.create(childCode, operationData, transaction);
        await this.createMany(childCode, operationData, transaction);
    }

    hasChild(data: IAnyObject, code: string) {
        const model = this.db.modelStore.get(code);
        return (model.childCodes ?? []).some((childCode) => data[toChildValueKey(childCode)]);
    }

    async create(code: string, data: IAnyObject, transaction: Knex.Transaction) {
        return this.db.middlewareManager.run('createChild', code, { data }, async (ctx) => {
            const model = this.db.modelStore.get(code);

            for (const childCode of model.childCodes ?? []) {
                const childModel = this.db.modelStore.get(childCode);
                if (!childModel.parentRefFieldCode) {
                    LliDbError.throw500(`模型${childCode}没有父级关联字段`);
                }

                const childData = ctx.params.data[toChildValueKey(childModel.code)];
                if (!Array.isArray(childData)) {
                    continue;
                }

                const deleteRequests: Array<{ id: string; parentId: string }> = [];
                const operationData: IRow[] = [];
                for (const item of childData as IRow[]) {
                    item[childModel.parentRefFieldCode] = ctx.params.data.id;
                    if (checkIsDelete(item)) {
                        deleteRequests.push({
                            id: item.id as string,
                            parentId: ctx.params.data.id as string,
                        });
                    } else {
                        operationData.push(item);
                    }
                }

                await this.deleteChildren(
                    childCode,
                    childModel.parentRefFieldCode,
                    deleteRequests,
                    transaction,
                );

                await this.writeChildren(
                    childCode,
                    childModel.parentRefFieldCode,
                    operationData,
                    transaction,
                );
            }
        });
    }

    async createMany(code: string, list: IAnyObject[], transaction: Knex.Transaction) {
        return this.db.middlewareManager.run('createChildMany', code, { data: list }, async (ctx) => {
            const model = this.db.modelStore.get(code);

            for (const childCode of model.childCodes ?? []) {
                const childModel = this.db.modelStore.get(childCode);
                if (!childModel.parentRefFieldCode) {
                    LliDbError.throw500(`模型${childCode}没有父级关联字段`);
                }

                const deleteRequests: Array<{ id: string; parentId: string }> = [];
                const operationData: IRow[] = [];
                for (const row of ctx.params.data as IAnyObject[]) {
                    const childData = row[toChildValueKey(childModel.code)];
                    if (!Array.isArray(childData)) {
                        continue;
                    }
                    for (const item of childData as IRow[]) {
                        item[childModel.parentRefFieldCode] = row.id;
                        if (checkIsDelete(item)) {
                            deleteRequests.push({
                                id: item.id as string,
                                parentId: row.id as string,
                            });
                        } else {
                            operationData.push(item);
                        }
                    }
                }

                await this.deleteChildren(
                    childCode,
                    childModel.parentRefFieldCode,
                    deleteRequests,
                    transaction,
                );

                await this.writeChildren(
                    childCode,
                    childModel.parentRefFieldCode,
                    operationData,
                    transaction,
                );
            }
        });
    }

    async clone(
        code: string,
        cloneId: string,
        data: IAnyObject,
        transaction: Knex.Transaction,
    ) {
        const model = this.db.modelStore.get(code);

        for (const childCode of model.childCodes ?? []) {
            const childModel = this.db.modelStore.get(childCode);
            if (!childModel.parentRefFieldCode) {
                LliDbError.throw500(`模型${childCode}没有父级关联字段`);
            }
            data[toChildValueKey(childModel.code)] = await this.createQueryBuilder(childCode)
                .select('id')
                .where({ [childModel.parentRefFieldCode]: cloneId })
                .transacting(transaction)
                .execute();
        }
        await this.create(code, data, transaction);
    }
}
