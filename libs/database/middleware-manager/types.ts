import type { Database } from '../database';
import { IModel } from '../types/model';
import { IAnyObject } from '../types/any-object';

export type IAction =
    | 'create'
    | 'createChild'
    | 'update'
    | 'delete'
    | 'findOne'
    | 'findMany'
    | 'queryPage'
    | 'count'
    | 'max'
    | 'min'
    | 'createMany'
    | 'createChildMany'
    | 'updateMany'
    | 'deleteMany'
    | 'deleteChildMany';

export interface IMiddlewareCtx extends IAnyObject {
    db: Database,
    model: IModel,
    action: IAction,
    params: IAnyObject,
    state: IAnyObject,
    result: any,
}
