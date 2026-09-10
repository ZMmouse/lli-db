export const checkIsDelete = (data: any) => {
    return data.__op === 'delete';
};

export const checkIsCreate = (data: any) => {
    return data.__op === 'create';
};

export const checkIsUpdate = (data: any) => {
    return data.__op === 'update';
};
