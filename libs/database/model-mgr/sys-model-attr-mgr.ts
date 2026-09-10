import type { Database } from '../database';
import type { ISysModelAttrMgr } from './types';
import { SysExpansionFieldTypeEnum, SysFieldTypeEnum } from '../enum/field-type-enum';

export const createSysModelAttrMgr = (
    db: Database,
    {
        userModelCode = 'sysUser',
        userModelDisplayCode = 'nickname',
    }: { userModelCode?: string; userModelDisplayCode?: string },
): ISysModelAttrMgr => {
    const createdAttribute = {
        createdAt: {
            code: 'createdAt',
            type: SysFieldTypeEnum.DATETIME,
            columnName: 'created_at',
            name: '创建时间',
            required: false,
        },
        createdBy: {
            code: 'createdBy',
            type: SysFieldTypeEnum.SINGLE_QUOTE,
            columnName: 'created_by',
            name: '创建人',
            required: false,
            refCode: userModelCode,
            refDisplayCode: userModelDisplayCode,
            refFieldCode: 'id',
        },
    };
    const updatedAttribute = {
        updatedAt: {
            code: 'updatedAt',
            type: SysFieldTypeEnum.DATETIME,
            columnName: 'updated_at',
            name: '更新时间',
            required: false,
        },
        updatedBy: {
            code: 'updatedBy',
            type: SysFieldTypeEnum.SINGLE_QUOTE,
            columnName: 'updated_by',
            name: '更新人',
            required: false,
            refCode: userModelCode,
            refDisplayCode: userModelDisplayCode,
            refFieldCode: 'id',
        },
    };

    const logicDeleteAttribute = {
        deletedAt: {
            code: 'deletedAt',
            type: SysFieldTypeEnum.DATETIME,
            columnName: 'deleted_at',
            name: '删除时间',
            required: false,
        },
        deletedBy: {
            code: 'deletedBy',
            type: SysFieldTypeEnum.SINGLE_QUOTE,
            columnName: 'deleted_by',
            name: '删除人',
            refCode: userModelCode,
            refDisplayCode: userModelDisplayCode,
            refFieldCode: 'id',
        },
        deleted: {
            code: 'deleted',
            type: SysFieldTypeEnum.SWITCH,
            columnName: 'deleted',
            name: '是否删除',
            required: false,
            default: false,
        },
    };

    const enabledAttribute = {
        enabled: {
            code: 'enabled',
            type: SysFieldTypeEnum.SWITCH,
            columnName: 'enabled',
            name: '是否启用',
            default: true,
        },
        enabledAt: {
            code: 'enabledAt',
            type: SysFieldTypeEnum.DATETIME,
            columnName: 'enabled_at',
            name: '启用时间',
        },
        enabledBy: {
            code: 'enabledBy',
            type: SysFieldTypeEnum.SINGLE_QUOTE,
            columnName: 'enabled_by',
            name: '启用人',
            refCode: userModelCode,
            refDisplayCode: userModelDisplayCode,
            refFieldCode: 'id',
        },
    };

    const treeAttribute = {
        parentId: {
            code: 'parentId',
            type: SysFieldTypeEnum.TEXT,
            columnName: 'parent_id',
            name: '父级ID',
        },
        parentCode: {
            code: 'parentCode',
            type: SysFieldTypeEnum.TEXT,
            columnName: 'parent_code',
            name: '父级编码',
        },
        parentUri: {
            code: 'parentUri',
            type: SysFieldTypeEnum.TEXT,
            columnName: 'parent_uri',
            name: '父级路径',
        },
    };

    return {
        getIdAttribute() {
            return {
                code: 'id',
                type: SysExpansionFieldTypeEnum.UID,
                columnName: 'id',
                name: 'ID',
                required: true,
                unique: true,
                primary: true,
            };
        },
        getCreatedAttribute() {
            return createdAttribute;
        },
        getUpdatedAttribute() {
            return updatedAttribute;
        },
        getLogicDeleteAttribute() {
            return logicDeleteAttribute;
        },
        getEnabledAttribute() {
            return enabledAttribute;
        },
        getTreeAttribute() {
            return treeAttribute;
        },
    };
};
