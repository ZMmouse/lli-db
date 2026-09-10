import type { Knex } from 'knex';
import { v4 as uuidV4 } from 'uuid';
import type { Database } from '../database';
import { QueryBuilder } from '../query';
import type { IAnyObject } from '../types/any-object';
import type { IRow } from '../types/i-row';
import { typeUtil } from '../utils';

export class RelationWriter {
    constructor(private readonly db: Database) {}

    private createQueryBuilder(code: string) {
        return new QueryBuilder(this.db, code);
    }

    hasRelations(data: IAnyObject, code: string) {
        const model = this.db.modelStore.get(code);
        return Object.values(model.attributes).some(
            (attribute) => typeUtil.isMultiQuote(attribute) && data[attribute.code],
        );
    }

    async create(code: string, data: IAnyObject[], transaction: Knex.Transaction) {
        const model = this.db.modelStore.get(code);

        for (const attribute of Object.values(model.attributes)) {
            if (!typeUtil.isMultiQuote(attribute)) {
                continue;
            }

            const newList: IRow[] = [];
            const ids: string[] = [];

            for (const item of data) {
                if (!Array.isArray(item[attribute.code])) {
                    continue;
                }

                ids.push(item.id as string);
                for (const refId of item[attribute.code] as string[]) {
                    newList.push({
                        id: uuidV4(),
                        [attribute.selfInMidFieldCode]: item.id,
                        [attribute.refInMidFieldCode]: refId,
                    });
                }
            }

            if (ids.length) {
                await this.createQueryBuilder(attribute.midCode)
                    .where({ [attribute.selfInMidFieldCode]: { in: ids } })
                    .transacting(transaction)
                    .delete()
                    .execute();
            }

            if (newList.length) {
                await this.createQueryBuilder(attribute.midCode)
                    .insert(newList)
                    .transacting(transaction)
                    .execute();
            }
        }
    }

    async clone(
        code: string,
        cloneId: string,
        data: IAnyObject,
        transaction: Knex.Transaction,
    ) {
        const model = this.db.modelStore.get(code);

        for (const [key, attribute] of Object.entries(model.attributes)) {
            if (!typeUtil.isMultiQuote(attribute)) {
                continue;
            }

            const rows = await this.createQueryBuilder(attribute.midCode)
                .where({ [attribute.selfInMidFieldCode]: cloneId })
                .transacting(transaction)
                .execute();
            data[key] = rows.map(
                (row: IAnyObject) => row[attribute.refInMidFieldCode] as string,
            );
        }
        await this.create(code, [data], transaction);
    }
}
