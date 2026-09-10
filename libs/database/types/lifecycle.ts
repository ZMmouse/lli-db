import type { IModel } from './model';
import type { IDatabase } from './database';
import { IAnyObject } from './any-object';
import type { IAction } from '../middleware-manager/types';
import type { IParams } from './query';

export type ILifecycleAction = `before${Capitalize<IAction>}` | `after${Capitalize<IAction>}`;

export interface ISubscribeEvent {
    action: ILifecycleAction;
    params: IParams;
    state: Record<string, unknown>;
    model: IModel;
    db: IDatabase;
    result?: IAnyObject | IAnyObject[];
}

export type ISubscriberFn = (event: ISubscribeEvent) => Promise<void> | void;

export type ISubscriberMap = {
    models?: string[];
} & Partial<Record<ILifecycleAction, ISubscriberFn>>;

export type ISubscriber = ISubscriberFn | ISubscriberMap;
