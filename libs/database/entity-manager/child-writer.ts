import type { Knex } from 'knex';
import type { Database } from '../database';
import { LliDbError } from '../error/lli-db-error';
import { QueryBuilder } from '../query';
import type { IAnyObject } from '../types/any-object';
import type { IRow } from '../types/i-row';
import { DeletePlanner } from './delete-planner';
import { processData } from './process-data';
import { RelationWriter } from './relation-writer';
import { toChildValueKey } from './transform';
import { checkIsDelete } from './utils';

export class ChildWriter {
    constructor(
        private readonly db: Database,
        private readonly relationWriter: RelationWriter,
        private readonly deletePlanner: DeletePlanner,
    ) {}

    private createQueryBuilder(code: string) {
        return new QueryBuilder(this.db, code);
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

                const deleteIds: string[] = [];
                const operationData: IRow[] = [];
                for (const item of childData as IRow[]) {
                    item[childModel.parentRefFieldCode] = ctx.params.data.id;
                    if (checkIsDelete(item)) {
                        deleteIds.push(item.id as string);
                    } else {
                        operationData.push(item);
                    }
                }

                if (deleteIds.length) {
                    await this.createQueryBuilder(childCode)
                        .where({ id: { in: deleteIds } })
                        .transacting(transaction)
                        .delete()
                        .execute();
                    await this.deletePlanner.deleteRelations(childCode, deleteIds, transaction);
                }

                if (operationData.length) {
                    const newData = operationData.map((item) =>
                        processData(this.db, item, childModel, { withDefaults: true }),
                    );
                    await this.createQueryBuilder(childCode)
                        .insert(newData)
                        .onConflict('id')
                        .merge([])
                        .returning('id')
                        .transacting(transaction)
                        .execute();
                    await this.relationWriter.create(childCode, operationData, transaction);
                    await this.createMany(childCode, operationData, transaction);
                }
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

                const deleteIds: string[] = [];
                const operationData: IRow[] = [];
                for (const row of ctx.params.data as IAnyObject[]) {
                    const childData = row[toChildValueKey(childModel.code)];
                    if (!Array.isArray(childData)) {
                        continue;
                    }
                    for (const item of childData as IRow[]) {
                        item[childModel.parentRefFieldCode] = row.id;
                        if (checkIsDelete(item)) {
                            deleteIds.push(item.id as string);
                        } else {
                            operationData.push(item);
                        }
                    }
                }

                if (deleteIds.length) {
                    await this.createQueryBuilder(childCode)
                        .where({ id: { in: deleteIds } })
                        .transacting(transaction)
                        .delete()
                        .execute();
                    await this.deletePlanner.deleteRelations(childCode, deleteIds, transaction);
                }

                if (operationData.length) {
                    const newData = operationData.map((item) =>
                        processData(this.db, item, childModel, { withDefaults: true }),
                    );
                    await this.createQueryBuilder(childCode)
                        .insert(newData)
                        .onConflict('id')
                        .merge([])
                        .transacting(transaction)
                        .execute();
                    await this.relationWriter.create(childCode, operationData, transaction);
                    await this.createMany(childCode, operationData, transaction);
                }
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
