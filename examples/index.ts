import * as process from 'node:process';
import { db } from './db';
import { ModelTableMigrator } from '../libs/migrator';

const users: any[] = [];
for (let i = 0; i < 20; i++) {
    users.push({
        username: `D${i}`,
        nickname: `D${i}`,
        password: 'pwd',
        email: `d${i}@example.com`,
        phone: `D${i}`,
        createdBy: '1',
        role: ['1'],
        sysUserFriendList: [
            {
                friendId: '1',
                isTop: 1,
            },
            {
                friendId: '2',
                isTop: 0,
            },
        ],
    });
}

const fun = async () => {
    // const m = new ModelTableMigrator(db);
    // await m.syncAll();

    const res = await db.query('learningPlan').update({
        where: {
            id: 'e3a6a237-a21d-43b0-8db1-c6437fe383e7',
        },
        data: {
            genStatus: 'done',
        },
    });
    console.log(res);

    /*const entity = db.query('sysUser');
    const res = await entity.clone('1', {
        data: {
            username: 'clone-user',
            nickname: 'clone-user',
            money: 0,
        },
    });
    console.log(res);*/

    process.exit(0);
};

fun();
