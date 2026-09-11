import type { IAttribute, IEntity } from '../types/model';

export interface IIndex {
    codes: string[];
    name: string;
    type?: 'primary' | 'unique';
}

export interface ISysModelAttrMgr {
    getCreatedAttribute(): Record<string, IAttribute>;
    getUpdatedAttribute(): Record<string, IAttribute>;
    getLogicDeleteAttribute(): Record<string, IAttribute>;
    getEnabledAttribute(): Record<string, IAttribute>;
    getTreeAttribute(): Record<string, IAttribute>;
    getIdAttribute(): IAttribute;
    getRevisionAttribute(): IAttribute;
}

export interface IEntityStorage {
    getAllPublishedEntities(): Promise<IEntity[]>;
}
