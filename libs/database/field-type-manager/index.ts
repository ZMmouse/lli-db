import { assign } from 'lodash';
import { IExpansionField, IField } from '../types/i-field';
import { LliDbError } from '../error/lli-db-error';
import type { Database } from '../database';
import { registerExpansionFieldTypes } from './expansion-field-types';
import { registerFieldTypes } from './field-types';

export class FieldTypeManager {
    private _db: Database;
    private map: Map<string, IExpansionField | IField> = new Map();

    constructor(db: Database) {
        this._db = db;
        registerFieldTypes(this);
        registerExpansionFieldTypes(this);
    }

    extends(field: IExpansionField | IField) {
        if (this.map.has(field.name)) {
            LliDbError.throw500(`扩展字段已存在: ${field.name}`);
        }
        this.map.set(field.name, field);
        if (field.middlewares) this._db.middlewareManager.registerFieldMiddlewareByMap(field.middlewares);
    }

    has(name: string) {
        return this.map.has(name);
    }

    get(name: string): IField {
        let newField = {};
        let inherit: string | undefined = name;
        while (inherit) {
            const field = this.map.get(inherit);
            if (!field) {
                LliDbError.throw500(`${name} 继承的字段类型不存在: ${inherit}`);
            }
            newField = assign({}, field, newField);
            inherit = field.inherit;
        }
        return newField as IField;
    }

    getBaseFieldType(name: string) {
        let baseField: IField | IExpansionField = {} as IField;
        let inherit: string | undefined = name;
        while (inherit) {
            const field = this.map.get(inherit);
            if (!field) {
                LliDbError.throw500(`${name} 继承的字段类型不存在: ${inherit}`);
            }
            baseField = field;
            inherit = field.inherit;
        }
        return baseField;
    }
}
