import { Knex } from 'knex';
import type { Database } from '../database';
import type { ICursorPageParams, IParams, IUpdateManyParams } from '../types/query';
import { IAnyObject } from '../types/any-object';
import type { ICursorPageResult, IPageResult, IUpdateManyResult } from '../types/i-result';

export class EntityRepository<T = IAnyObject> {
    private readonly db;
    private readonly code;

    constructor(db: Database, code: string) {
        this.db = db;
        this.code = code;
    }

    findOne(params: IParams = {}): Promise<T | null> {
        return this.db.entityManager.findOne<T>(this.code, params);
    }

    findMany(params: IParams = {}): Promise<T[]> {
        return this.db.entityManager.findMany<T>(this.code, params);
    }

    queryPage(params: IParams = {}): Promise<IPageResult<T>> {
        return this.db.entityManager.queryPage<T>(this.code, params);
    }

    findCursorPage(params: ICursorPageParams): Promise<ICursorPageResult<T>> {
        return this.db.entityManager.findCursorPage<T>(this.code, params);
    }

    count(params: IParams, fieldCode = 'id') {
        return this.db.entityManager.count(this.code, params, fieldCode);
    }

    max(params: IParams, fieldCode = 'id') {
        return this.db.entityManager.max(this.code, fieldCode, params);
    }

    min(params: IParams, fieldCode = 'id') {
        return this.db.entityManager.min(this.code, fieldCode, params);
    }

    create(params: IParams): Promise<T> {
        return this.db.entityManager.create<T>(this.code, params);
    }

    createMany(params: IParams): Promise<T[]> {
        return this.db.entityManager.createMany<T>(this.code, params);
    }

    clone(cloneId: string, params: IParams & { cloneChild?: boolean } = {}): Promise<T> {
        return this.db.entityManager.clone<T>(this.code, cloneId, params);
    }

    update(params: IParams): Promise<T | null> {
        return this.db.entityManager.update<T>(this.code, params);
    }

    updateMany(params: IUpdateManyParams): Promise<IUpdateManyResult> {
        return this.db.entityManager.updateMany(this.code, params);
    }

    enabled(code: string, id: string) {
        return this.db.entityManager.enabled(code, id);
    }

    unenabled(code: string, id: string) {
        return this.db.entityManager.unenabled(code, id);
    }

    delete(params: IParams): Promise<number> {
        return this.db.entityManager.delete(this.code, params);
    }

    deleteMany(params: IParams) {
        return this.db.entityManager.deleteMany(this.code, params);
    }

    createChild(data: Record<string, unknown>, transaction: Knex.Transaction) {
        return this.db.entityManager.createChild(this.code, data, { transaction });
    }

    createChildMany(list: Array<Record<string, unknown>>, transaction: Knex.Transaction) {
        return this.db.entityManager.createChildMany(this.code, list, { transaction });
    }

    deleteChildMany(ids: string[], transaction: Knex.Transaction) {
        return this.db.entityManager.deleteChildMany(this.code, ids, { transaction });
    }

    deleteRelations(ids: string[], transaction: Knex.Transaction) {
        return this.db.entityManager.deleteRelations(this.code, ids, { transaction });
    }

    createRelations(data: Array<Record<string, unknown>>, transaction: Knex.Transaction) {
        return this.db.entityManager.createRelations(this.code, data, { transaction });
    }
}
