import { checkValidSubscriber } from './utils';
import type {
    ILifecycleAction,
    ISubscribeEvent,
    ISubscriber,
} from '../types/lifecycle';
import type { IParams } from '../types/query';
import type { Database } from '../database';
import { LliDbError } from '../error/lli-db-error';
import type { IAction } from '../middleware-manager/types';

export const toLifecycleAction = (phase: 'before' | 'after', action: IAction): ILifecycleAction => {
    return `${phase}${action.charAt(0).toUpperCase()}${action.slice(1)}` as ILifecycleAction;
};

export type IState = Record<string, unknown>;
export type IStates = Map<ISubscriber, IState>;

export interface IProperties {
    params: IParams;
    result?: unknown;
}

export interface ILifecycleProvider {
    subscribe(subscriber: ISubscriber): () => void;
    clear(): void;
    createEvent(
        action: ILifecycleAction,
        code: string,
        properties: IProperties,
        state: IState,
    ): ISubscribeEvent;
    run(
        action: ILifecycleAction,
        code: string,
        properties: IProperties,
        states?: IStates,
    ): Promise<IStates>;
}

export const createLifecycleProvider = (db: Database): ILifecycleProvider => {
    let subscribers: ISubscriber[] = [];

    return {
        subscribe(subscriber: ISubscriber) {
            if (!checkValidSubscriber(subscriber)) {
                LliDbError.throw400('subscriber参数类型错误，类型必须为function或object');
            }

            subscribers.push(subscriber);

            return () => {
                subscribers = subscribers.filter((s) => s !== subscriber);
            };
        },
        clear() {
            subscribers = [];
        },

        createEvent(
            action: ILifecycleAction,
            code: string,
            properties: IProperties,
            state: IState,
        ) {
            const model = db.modelStore.get(code);

            return {
                action,
                model,
                state,
                db,
                ...properties,
            } as ISubscribeEvent;
        },

        async run(
            action: ILifecycleAction,
            code: string,
            properties: IProperties,
            states: IStates = new Map(),
        ) {
            for (let i = 0; i < subscribers.length; i++) {
                const subscriber = subscribers[i];

                if (typeof subscriber === 'function') {
                    const state = states.get(subscriber) || {};
                    const event = this.createEvent(action, code, properties, state);
                    await subscriber(event);

                    if (event.state) {
                        states.set(subscriber, event.state || state);
                    }
                    continue;
                }

                const hasAction = action in subscriber;
                const hasModel = !subscriber.models || subscriber.models.includes(code);

                if (hasAction && hasModel) {
                    const state = states.get(subscriber) || {};
                    const event = this.createEvent(action, code, properties, state);

                    await subscriber[action]?.(event);

                    if (event.state) {
                        states.set(subscriber, event.state || state);
                    }
                }
            }
            return states;
        },
    };
};
