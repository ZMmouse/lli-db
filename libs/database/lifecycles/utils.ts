import type { ISubscriber } from '../types/lifecycle';

export const checkValidSubscriber = (subscriber: ISubscriber) => {
    return (
        typeof subscriber === 'function' || (typeof subscriber === 'object' && subscriber !== null)
    );
};
