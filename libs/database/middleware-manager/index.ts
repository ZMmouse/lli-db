import type { Database } from '../database';
import { IMiddleware } from '../types/middleware';
import { IAction, IMiddlewareCtx } from './types';
import { compose } from '../utils/compose';
import { registerLogicDeleteRMiddleware } from './global-middlewares/logic-delete.r';
import { registerTimestampsCUMiddleware } from './global-middlewares/timestamps.cu';
import { registerTreeCUMiddleware } from './global-middlewares/tree.cu';
import { normalizeQueryParams } from '../query/helpers/normalize-params';
import { cloneDeep } from 'lodash';
import { toLifecycleAction } from '../lifecycles';
import { validateWriteParams } from '../entity-manager/validate-write';

export class MiddlewareManager {
    private globalMiddlewares: Map<IAction, IMiddleware<IMiddlewareCtx>[]> = new Map();
    private fieldMiddlewares: Map<IAction, IMiddleware<IMiddlewareCtx>[]> = new Map();

    constructor(private db: Database) {
        registerLogicDeleteRMiddleware(this);
        registerTreeCUMiddleware(this);
        registerTimestampsCUMiddleware(this);
    }

    registerGlobalMiddleware(action: IAction, middleware: IMiddleware<IMiddlewareCtx>) {
        if (!this.globalMiddlewares.has(action)) {
            this.globalMiddlewares.set(action, []);
        }
        this.globalMiddlewares.get(action)!.push(middleware);
    }
    registerFieldMiddleware(action: IAction, middleware: IMiddleware<IMiddlewareCtx>) {
        if (!this.fieldMiddlewares.has(action)) {
            this.fieldMiddlewares.set(action, []);
        }
        this.fieldMiddlewares.get(action)!.push(middleware);
    }
    registerFieldMiddlewareByMap(map: Partial<Record<IAction, IMiddleware<IMiddlewareCtx>>>) {
        Object.entries(map).forEach(([action, middleware]) => {
            this.registerFieldMiddleware(action as IAction, middleware);
        });
    }

    async run(
        action: IAction,
        modelCode: string,
        params: any,
        coreRunner: (ctx: IMiddlewareCtx) => Promise<any>,
    ) {
        const model = this.db.modelStore.get(modelCode);
        params = cloneDeep(normalizeQueryParams(params));
        const ctx: IMiddlewareCtx = {
            db: this.db,
            model,
            action,
            params,
            state: {},
            result: null,
        };
        validateWriteParams(this.db, model, action, ctx.params);
        const lifecycleStates = await this.db.lifecycleProvider.run(
            toLifecycleAction('before', action),
            modelCode,
            { params: ctx.params },
        );
        const globalMiddlewares = this.globalMiddlewares.get(action) ?? [];
        const modelMiddleware = model.middlewares?.[action];
        const fieldMiddlewares = this.fieldMiddlewares.get(action) ?? [];
        const stack = [...globalMiddlewares];
        if (modelMiddleware) {
            stack.push(modelMiddleware);
        }
        stack.push(...fieldMiddlewares, async (ctx: IMiddlewareCtx) => {
            await coreRunner(ctx);
        });
        const runner = compose(stack);
        await runner(ctx);
        await this.db.lifecycleProvider.run(
            toLifecycleAction('after', action),
            modelCode,
            { params: ctx.params, result: ctx.result },
            lifecycleStates,
        );
        return ctx.result;
    }
}
