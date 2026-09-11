import type { Knex } from 'knex';
import type { Database } from '../database';
import { LliDbError } from '../error/lli-db-error';
import { QueryBuilder } from '../query';
import { typeUtil } from '../utils';

export class DeletePlanner {
    constructor(private readonly db: Database) {}

    private createQueryBuilder(code: string) {
        return new QueryBuilder(this.db, code);
    }

    checkUseLogicDelete(code: string) {
        const model = this.db.modelStore.get(code);
        if (!model) {
            LliDbError.throwModelNotFound(code);
        }
        return model.useLogicDelete;
    }

    deleteRows(code: string, ids: string[], fieldCode = 'id', transaction?: Knex.Transaction) {
        const query = this.createQueryBuilder(code)
            .where({ [fieldCode]: { in: ids } })
            .transacting(transaction);

        if (this.checkUseLogicDelete(code)) {
            const updateQuery = query.update({
                deleted: true,
                deletedAt: new Date(),
            });
            if (this.db.modelStore.get(code).useRevision) {
                updateQuery.increment('revision');
            }
            return updateQuery.execute();
        }
        return query.delete().execute();
    }

    async deleteRelations(code: string, ids: string[], transaction: Knex.Transaction) {
        const model = this.db.modelStore.get(code);

        for (const attribute of Object.values(model.attributes)) {
            if (!typeUtil.isMultiQuote(attribute)) {
                continue;
            }

            await this.deleteRows(
                attribute.midCode,
                ids,
                attribute.selfInMidFieldCode,
                transaction,
            );
        }
    }

    async deleteChildMany(code: string, ids: string[], transaction: Knex.Transaction) {
        return this.db.middlewareManager.run(
            'deleteChildMany',
            code,
            { data: ids },
            async (ctx) => {
                const model = this.db.modelStore.get(code);

                for (const childCode of model.childCodes ?? []) {
                    const childModel = this.db.modelStore.get(childCode);
                    if (!childModel.parentRefFieldCode) {
                        LliDbError.throw500(`模型${childCode}没有父级关联字段`);
                    }

                    const rows = await this.createQueryBuilder(childCode)
                        .select('id')
                        .where({
                            [childModel.parentRefFieldCode]: { in: ctx.params.data },
                        })
                        .transacting(transaction)
                        .execute<Array<Record<'id', string>>>();
                    const childIds = rows.map((row) => row.id);

                    await this.deleteRows(childCode, childIds, 'id', transaction);
                    await this.deleteRelations(childCode, childIds, transaction);
                    await this.deleteChildMany(childCode, childIds, transaction);
                }
            },
        );
    }
}
