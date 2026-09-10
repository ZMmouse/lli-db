import { IMiddleware, INextFunction } from '../types/middleware';

export const compose = <T>(middlewares: IMiddleware<T>[]) => {
    return (ctx: T, next?: INextFunction) => {
        let index = -1;
        function dispatch(i: number): Promise<void> {
            if (i <= index) {
                return Promise.reject(new Error('next() called multiple times'));
            }
            index = i;
            let fn = middlewares[i];
            if (i === middlewares.length) {
                fn = next as IMiddleware<T>;
            }
            if (!fn) {
                return Promise.resolve();
            }
            try {
                return Promise.resolve(fn(ctx, dispatch.bind(null, i + 1)));
            } catch (err) {
                return Promise.reject(err);
            }
        }
        return dispatch(0);
    }
};
