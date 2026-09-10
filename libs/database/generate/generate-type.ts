import { upperFirst } from 'lodash';
import { IModel } from '../types/model';
import * as process from 'node:process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { SysFieldTypeEnum } from '../enum/field-type-enum';
import type { Database } from '../database';

// 根据模型生成类型文件
export const generateType = (
    db: Database,
    models: IModel[],
    appRoot: string = process.cwd(),
    typeOutDir: string = 'src/lli-db-types',
) => {
    const dir = path.join(appRoot, typeOutDir);

    // 判断文件夹是否存在
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    for (const model of models) {
        const code = `I${upperFirst(model.code)}`;
        const content = `export interface ${code} {
    ${Object.entries(model.attributes)
        .map(([, attribute]) => {
            const baseFieldType = db.fieldTypeManager.getBaseFieldType(attribute.type);
            return `${attribute.code}${attribute.required ? '' : '?'}: ${getValueType(attribute.primitiveType ?? baseFieldType.name)};`;
        })
        .join('\n   ')}
}`;
        fs.writeFileSync(path.join(dir, `${code}.ts`), content);
    }
};

const getValueType = (type: string) => {
    switch (type) {
        case SysFieldTypeEnum.INT:
        case SysFieldTypeEnum.FLOAT:
            return 'number';
        case SysFieldTypeEnum.SWITCH:
            return 'boolean';
        case SysFieldTypeEnum.JSON:
            return 'Record<string, unknown> | unknown[]';
        case SysFieldTypeEnum.MULTI_QUOTE:
            return 'Record<string, unknown>[]';
        default:
            return 'string';
    }
};
