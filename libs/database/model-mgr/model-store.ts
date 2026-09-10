import type { IModelStore } from '../types/model-store';
import type { Database } from '../database';
import type { IModel } from '../types/model';
import { LliDbError } from '../error/lli-db-error';

export class ModelStore implements IModelStore {
    private db: Database;
    private cache: Map<string, IModel> = new Map<string, IModel>();
    private waitBindParentMap = new Map<string, string[]>();

    constructor(db: Database) {
        this.db = db;
    }

    get(key: string) {
        const model = this.cache.get(key);
        if (!model) {
            LliDbError.throwModelNotFound(key);
        }
        return model;
    }

    has(key: string) {
        return this.cache.has(key);
    }

    add(model: IModel) {
        model.attributes.id = this.db.sysModelAttrMgr.getIdAttribute();
        if (model.useCreatedFields) {
            Object.assign(model.attributes, this.db.sysModelAttrMgr.getCreatedAttribute());
        }
        if (model.useUpdatedFields) {
            Object.assign(model.attributes, this.db.sysModelAttrMgr.getUpdatedAttribute());
        }
        if (model.useLogicDelete) {
            Object.assign(model.attributes, this.db.sysModelAttrMgr.getLogicDeleteAttribute());
        }
        if (model.useTree) {
            if (!('code' in model.attributes)) {
                LliDbError.throw500('开启树形必须要有code属性');
            }
            Object.assign(model.attributes, this.db.sysModelAttrMgr.getTreeAttribute());
        }
        if (model.useEnabled) {
            Object.assign(model.attributes, this.db.sysModelAttrMgr.getEnabledAttribute());
        }

        if (this.waitBindParentMap.has(model.code)) {
            model.childCodes = this.waitBindParentMap.get(model.code) ?? [];
            this.waitBindParentMap.delete(model.code);
        }

        if (model.parentCode) {
            if (this.has(model.parentCode)) {
                const parentModel = this.get(model.parentCode);
                if (!parentModel.childCodes) {
                    parentModel.childCodes = [];
                }
                if (!parentModel.childCodes.includes(model.code)) {
                    parentModel.childCodes.push(model.code);
                }
            } else {
                if (!this.waitBindParentMap.has(model.parentCode)) {
                    this.waitBindParentMap.set(model.parentCode, []);
                }
                this.waitBindParentMap.get(model.parentCode)!.push(model.code);
            }
        }
        this.cache.set(model.code, model);
    }
    addModels(models: IModel[]) {
        models.forEach((model) => this.add(model));
    }

    getModels() {
        return Array.from(this.cache.values());
    }
}
