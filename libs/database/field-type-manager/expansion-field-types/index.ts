import { FieldTypeManager } from '../index';
import bigText from './big-text';
import color from './color';
import singleSelect from './single-select';
import multiSelect from './multi-select';
import money from './money';
import uid from './uid';
import jsonObject from './json-object';
import jsonArray from './json-array';
import encryptText from './encrypt-text';
import revision from './revision';

export const registerExpansionFieldTypes = (fieldTypeManager: FieldTypeManager) => {
    fieldTypeManager.extends(encryptText);
    fieldTypeManager.extends(bigText);
    fieldTypeManager.extends(money);
    fieldTypeManager.extends(color);
    fieldTypeManager.extends(singleSelect);
    fieldTypeManager.extends(multiSelect);
    fieldTypeManager.extends(uid);
    fieldTypeManager.extends(jsonObject);
    fieldTypeManager.extends(jsonArray);
    fieldTypeManager.extends(revision);
};
