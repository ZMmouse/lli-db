import type { IModel } from './model';

export interface IModelStore {
    get(key: string): IModel;

    has(key: string): boolean;

    add(model: IModel): void;
}
