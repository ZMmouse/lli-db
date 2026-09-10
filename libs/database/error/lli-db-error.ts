export class LliDbError extends Error {
    code: string;
    detail: any;
    constructor(message: string, code = 'LLI500', detail?: any) {
        super(message);
        this.code = code;
        this.detail = detail;
        this.name = 'LliDbError';
    }

    static throw500(message: string): never {
        throw new LliDbError(message);
    }

    static throw400(message: string): never {
        throw new LliDbError(message, 'LLI400');
    }

    static throw40010(message: string, detail?: any): never {
        throw new LliDbError(message, 'LLI40010', detail);
    }

    static throwModelNotFound(code: string): never {
        throw new LliDbError(`模型 ${code} 不存在`, 'LLI400');
    }

    static throwModelAttributeNotFound(code: string, attr: string): never {
        throw new LliDbError(`模型 ${code} 中不存在 ${attr} 属性`, 'LLI400');
    }

    static throwModelNoAttribute(code: string): never {
        throw new LliDbError(`模型 ${code} 未设置任何属性`, 'LLI400');
    }

    static throwModelNotForChildCode(code: string, parentCode: string): never {
        throw new LliDbError(`模型 ${code} 不是 ${parentCode} 的子模型`, 'LLI400');
    }

    static throwAttrNotQuoteField(code: string): never {
        throw new LliDbError(`字段 ${code} 不是引用类型`, 'LLI400');
    }
}
