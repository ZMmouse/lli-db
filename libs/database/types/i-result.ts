import { IAnyObject } from './any-object';

export interface IPageResult<T = IAnyObject> {
    total: number;
    rows: T[];
}

export interface IUpdateManyResult {
    count: number;
    updateIds: string[];
}
