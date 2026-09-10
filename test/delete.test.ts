import { db } from './test-database';
import { IAnyObject } from '../libs/database/types/any-object';

const users: any[] = [];
for (let i = 0; i < 20; i++) {
    users.push({
        username: `D${i}`,
        nickname: `D${i}`,
        password: 'pwd',
        email: `delete-${i}@example.com`,
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

let resUsers: IAnyObject[] = [];

beforeAll(async () => {
    const res = await db.query('sysUser').createMany({
        data: users,
    });

    resUsers = res;
    return res;
});

test('删除单条数据', async () => {
    const [user] = resUsers.splice(0, 1);

    const res = await db.query('sysUser').delete({
        where: {
            username: user.username,
        },
    });
    expect(res).toEqual(1);
    const queryRes = await db.query('sysUser').findMany({
        where: {
            username: user.username,
        },
    });
    const roles = await db.query('sysUserRole').findMany({
        where: {
            userId: user.id,
        },
    });
    const friends = await db.query('sysUserFriend').findMany({
        where: {
            userId: user.id,
        },
    });
    expect(queryRes).toEqual([]);
    expect(roles.length).toEqual(0);
    expect(friends.length).toEqual(0);
});

test('删除多条数据', async () => {
    const usernames = resUsers.map((item) => item.username);
    const userIds = resUsers.map((item) => item.id);
    const res = await db.query('sysUser').deleteMany({
        where: {
            username: usernames,
        },
    });
    expect(res).toBeGreaterThanOrEqual(19);
    const queryRes = await db.query('sysUser').findMany({
        where: {
            username: usernames,
        },
    });
    const roles = await db.query('sysUserRole').findMany({
        where: {
            userId: userIds,
        },
    });
    const friends = await db.query('sysUserFriend').findMany({
        where: {
            userId: userIds,
        },
    });
    expect(queryRes).toEqual([]);
    expect(roles.length).toEqual(0);
    expect(friends.length).toEqual(0);
});
