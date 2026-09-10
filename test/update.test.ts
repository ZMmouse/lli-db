import { IAnyObject } from '../libs/database/types/any-object';
import { db } from './test-database';

const users: any[] = [];
for (let i = 0; i < 20; i++) {
    users.push({
        username: `Y${i}`,
        nickname: `Y${i}`,
        password: 'pwd',
        email: `update-${i}@example.com`,
        phone: `Y${i}`,
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

test('更新单条数据', async () => {
    const [user] = resUsers.splice(0, 1);
    const res = await db.query('sysUser').update({
        where: {
            id: user.id,
        },
        data: {
            username: '测试修改单条',
            role: ['2'],
            sysUserFriendList: [
                {
                    friendId: '3',
                    isTop: 1,
                },
            ],
        },
    });
    expect(res?.username).toEqual('测试修改单条');
    const updatedUser = await db.query('sysUser').findOne({
        where: {
            id: user.id,
        },
    });
    if (!updatedUser) throw new Error('expected updated sysUser');
    expect(updatedUser.username).toEqual('测试修改单条');

    const userRole = await db.query('sysUserRole').findOne({
        where: {
            userId: user.id,
        },
    });
    if (!userRole) throw new Error('expected sysUserRole');
    expect(userRole.roleId).toEqual('2');
    const userFriends = await db.query('sysUserFriend').findMany({
        where: {
            userId: user.id,
        },
    });
    expect(userFriends.some((item: IAnyObject) => item.friendId === '3')).toEqual(true);
});

test('更新多条数据', async () => {
    const res = await db.query('sysUser').updateMany({
        where: {
            nickname: {
                startsWith: 'Y',
            },
        },
        data: {
            username: '更新多条数据',
            role: ['2'],
        },
    });
    expect(res.count).toBe(20);
    const userIds = resUsers.map((user) => user.id);
    const updatedUsers = await db.query('sysUser').findMany({
        where: {
            id: userIds,
        },
    });
    expect(updatedUsers.every((user: IAnyObject) => user.username === '更新多条数据')).toEqual(
        true,
    );

    const userRoles = await db.query('sysUserRole').findMany({
        where: {
            userId: userIds,
        },
    });

    expect(userRoles.every((userRole: IAnyObject) => userRole.roleId === '2')).toEqual(true);
});

test('增加数值', async () => {
    const res = await db.entityManager
        .createQueryBuilder('sysUser')
        .increment('money', 1)
        .where({
            id: '3',
        })
        .execute();
    expect(res).toEqual(1);
});

test('减少数值', async () => {
    const res = await db.entityManager
        .createQueryBuilder('sysUser')
        .decrement('money', 1)
        .where({
            id: '3',
        })
        .execute();
    expect(res).toEqual(1);
});
