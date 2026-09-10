export type INextFunction = () => Promise<void>;

export type IMiddleware<T> = (ctx: T, next: INextFunction) => Promise<void>;
