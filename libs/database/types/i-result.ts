import { IAnyObject } from './any-object';

export interface IPageResult<T = IAnyObject> {
    total: number;
    rows: T[];
}

export interface IUpdateManyResult {
    count: number;
    updateIds: string[];
}

export interface ICursorPageResult<T = IAnyObject> {
    rows: T[];
    hasMore: boolean;
    nextPosition?: Record<string, string | number | boolean | null>;
}
