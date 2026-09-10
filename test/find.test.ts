import { db } from './test-database';
import { isObject } from 'lodash';
import { IAnyObject } from '../libs/database/types/any-object';

test('查询单条', async () => {

    const res = await db.query('sysUser').findOne({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: 'm01',
        },
    });
    expect(isObject(res)).toBe(true);
    if (!res) throw new Error('expected sysUser m01');
    expect(res.username).toBe('m01');
    expect(res.createdBy).toMatchObject({
        nickname: 'admin',
        id: '1',
        username: 'admin',
    });
});

test('查询多条', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: {
                like: '%Test%',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);

    for (const re of res) {
        expect(re.username).toMatch(/Test/);
    }
});

test('查询多条，使用notLike过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: {
                notLike: 'Test',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.some((item: IAnyObject) => item.username.includes('Test'))).toBe(false);
});

test('查询多条，使用eq过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: 'admin',
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(1);
    expect(res[0].username).toBe('admin');
});

test('查询多条，使用notEq过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: {
                notEq: 'admin',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    const usernames = res.map((item: any) => item.username);
    expect(usernames).not.toContain('admin');
});

test('查询多条，使用gt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                gt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(1);
    expect(res[0].money).toBe(1);
});

test('查询多条，使用notGt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                notGt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    const max = Math.max(...res.map((item: any) => item.money));
    expect(max).toBeLessThanOrEqual(500);
});

test('查询多条，使用lt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                lt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    const max = Math.max(...res.map((item: any) => item.money));
    expect(max).toBeLessThan(0.5);
});

test('查询多条，使用notLt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                notLt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    const max = Math.max(...res.map((item: any) => item.money));
    expect(max).toBeGreaterThanOrEqual(0.5);
});

test('查询多条，使用egt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                egt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    const max = Math.max(...res.map((item: any) => item.money));
    expect(max).toBeGreaterThanOrEqual(0.5);
});

test('查询多条，使用egt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                egt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    const max = Math.max(...res.map((item: any) => item.money));
    expect(max).toBeGreaterThanOrEqual(0.5);
});

test('查询多条，使用notEgt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                notEgt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    const max = Math.max(...res.map((item: any) => item.money));
    expect(max).toBeLessThan(0.5);
});

test('查询多条，使用elt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                elt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    const max = Math.max(...res.map((item: any) => item.money));
    expect(max).toBeLessThanOrEqual(0.5);
});

test('查询多条，使用notElt过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                notElt: 500,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res[0].money).toBe(1);
});

test('查询多条，使用in过滤', async () => {
    const usernames = ['admin', 'm01'];
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: usernames,
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    for (const re of res) {
        expect(usernames.includes(re.username)).toBe(true);
    }
});

test('查询多条，使用notIn过滤', async () => {
    const usernames = ['admin', 'm01'];
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: {
                notIn: usernames,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    for (const re of res) {
        expect(usernames.includes(re.username)).toBe(false);
    }
});

test('查询多条，使用between过滤', async () => {
    const usernames = ['m02', 'm01'];
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                between: [500, 1000],
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    const max = Math.max(...res.map((re: any) => re.money));
    expect(max).toBeGreaterThanOrEqual(0.5);
    expect(max).toBeLessThanOrEqual(1);
    for (const re of res) {
        expect(usernames.includes(re.username)).toBe(true);
    }
});

test('查询多条，使用notBetween过滤', async () => {
    const usernames = ['m02', 'm01'];
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            money: {
                notBetween: [500, 1000],
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThan(0);
    const max = Math.max(...res.map((re: any) => re.money));
    expect(max > 0.1 || max < 0.5).toBe(true);
    for (const re of res) {
        expect(usernames.includes(re.username)).toBe(false);
    }
});

test('查询多条，使用isNull过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            createdAt: {
                isNull: true,
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThanOrEqual(1);
});

test('查询多条，使用startsWith过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: {
                startsWith: 'm',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    expect(res[0].username).toContain('m');
    expect(res[1].username).toContain('m');
});

test('查询多条，使用endsWith过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            email: {
                endsWith: 'admin.example.com',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThanOrEqual(1);
    expect(res[0].email.endsWith('admin.example.com')).toBe(true);
});

test('查询多条，多条件过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            email: {
                endsWith: 'm.example.com',
            },
            sysUserFriend: {
                friendId: '1',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(1);
    expect(res[0].username).toContain('m01');
});

test('查询多条，选择字段', async () => {
    const res = await db.query('sysUser').findMany({
        select: ['username', 'id', 'nickname'],
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: ['m01', 'm02'],
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    expect(!res[0].createdBy).toBe(true);
});

test('查询多条，选择字段指定别名', async () => {
    const res = await db.query('sysUser').findMany({
        select: ['username', 'id', 'nickname:name'],
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: ['m01', 'm02'],
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    expect(!res[0].nickname).toBe(true);
    expect(!!res[1].name).toBe(true);
});

test('查询多条，选择字段指定别名', async () => {
    const res = await db.query('sysUser').findMany({
        select: [
            'username',
            'id',
            {
                nickname: 'name',
            },
        ],
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            username: ['m01', 'm02'],
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);
    expect(!res[0].nickname).toBe(true);
    expect(!!res[1].name).toBe(true);
});

test('查询多条，查询所有字段', async () => {
    const res = await db.query('sysUser').findMany({
        select: '*',
        where: {
            username: ['m01', 'm02', 'admin'],
        },
    });
    expect(Array.isArray(res)).toBe(true);
});

test('查询多条，根据money排序降序', async () => {
    const res = await db.query('sysUser').findMany({
        orderBy: {
            money: 'desc',
        },
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].id).toBe('2');
});

test('查询多条，根据money排序增序', async () => {
    const res = await db.query('sysUser').findMany({
        orderBy: {
            money: 'asc',
        },
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res[res.length - 1].id).toBe('2');
});

test('查询多条，根据money默认asc', async () => {
    const res = await db.query('sysUser').findMany({
        orderBy: 'money',
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res[res.length - 1].id).toBe('2');
});

test('查询多条，根据money/createdAt排序增序', async () => {
    const res = await db.query('sysUser').findMany({
        orderBy: [
            {
                money: 'asc',
            },
            'createdAt',
        ],
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res[0].money <= res[res.length - 1].money).toBe(true);
});

test('查询多条，分页查询', async () => {
    const res = await db.query('sysUser').queryPage({
        orderBy: {
            id: 'asc',
        },
        page: 1,
        pageSize: 2,
    });

    expect(Array.isArray(res.rows)).toBe(true);
    expect(res.rows.length).toBe(2);
    expect(res.total).toBeGreaterThan(2);
});

test('查询多条，使用and查询', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            and: [
                {
                    username: {
                        notLike: 'Test',
                    },
                },
                {
                    email: {
                        endsWith: '.com',
                    },
                },
            ],
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(
        res.some((item: IAnyObject) => {
            return item.username.includes('Test') || !item.email.endsWith('.com');
        }),
    ).toBe(false);
});

test('查询多条，使用and查询', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            and: {
                username: {
                    notLike: 'Test',
                },
                email: {
                    endsWith: '.com',
                },
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(
        res.some((item: IAnyObject) => {
            return item.username.includes('Test') || !item.email.endsWith('.com');
        }),
    ).toBe(false);
});

test('查询多条，添加or过滤条件', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            or: {
                username: 'admin',
                nickname: 'm02',
            },
        },
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(2);

    expect(res[0].username).toBe('admin');
    expect(res[1].nickname).toBe('m02');
});

test('查询多条，添加or not过滤条件', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            not: {
                or: {
                    username: 'admin',
                    nickname: 'm02',
                },
            },
        },
    });
    expect(Array.isArray(res)).toBe(true);
    const usernames: string[] = [];
    const nicknames: string[] = [];
    res.forEach((item: any) => {
        usernames.push(item.username);
        nicknames.push(item.nickname);
    });
    expect(usernames.includes('admin')).toBe(false);
    expect(nicknames.includes('m02')).toBe(false);
});

test('查询多条，联查所有关联字段', async () => {
    const res = await db.query('sysUser').findMany({
        populate: '*',
        where: {
            username: {
                notLike: 'Test',
            },
        },
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBeGreaterThanOrEqual(3);
    for (const re of res) {
        expect(!!re.createdBy?.username).toBe(true);
    }
});

test('查询多条，根据多选引用过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            role: {
                name: '普通用户',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length > 0).toBe(true);
    expect(res.some((item: Record<string, any>) => item.username === 'm01')).toBe(true);
});

test('查询多条，根据单选引用过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            createdBy: {
                username: 'm01',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(1);
});

test('查询多条，联查多选引用数据', async () => {
    const usernames = ['admin', 'm02', 'm01'];
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
            role: {
                select: ['id', 'name'],
            },
        },
        where: {
            username: ['admin', 'm02', 'm01'],
        },
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length).toBe(3);

    for (const re of res) {
        expect(usernames.includes(re.username)).toBe(true);
        expect(re.role?.length > 0).toBe(true);
    }
});

test('查询单条，联查多选引用数据并过滤', async () => {
    const res = await db.query('sysUser').findOne({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
            role: {
                select: ['id', 'name'],
                where: {
                    name: '管理员',
                },
            },
        },
        where: {
            username: 'm02',
        },
    });

    expect(isObject(res)).toBe(true);
    if (!res) throw new Error('expected populated sysUser');
    expect(res.role.length).toBe(1);
    expect(res.role[0].name).toBe('管理员');
});

test('查询多条，根据子表过滤', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            createdBy: {
                select: ['nickname', 'id', 'username'],
            },
        },
        where: {
            sysUserFriend: {
                friendId: '1',
            },
        },
    });
    expect(Array.isArray(res)).toBe(true);
    expect(res.length > 0).toBe(true);
});

test('查询多条，联查子表', async () => {
    const res = await db.query('sysUser').findMany({
        populate: {
            sysUserFriend: {
                select: ['friendId', 'id'],
                populate: {
                    friendId: {
                        select: ['nickname', 'id', 'username'],
                    },
                },
            },
        },
        where: {
            sysUserFriend: {
                friendId: '1',
            },
        },
    });

    expect(Array.isArray(res)).toBe(true);
    for (const re of res) {
        expect(re).toHaveProperty('sysUserFriendList');
        expect(re.sysUserFriendList.length > 0).toBe(true);
    }
});

test('统计', async () => {
    const res = await db.query('sysUser').count({
        where: {
            money: {
                gt: 0,
            },
        },
    });
    expect(res).toBeGreaterThanOrEqual(3);
});

test('最大值', async () => {
    const res = await db.query('sysUser').max(
        {
            where: {
                money: {
                    gt: 0,
                },
            },
        },
        'money',
    );
    expect(res).toBe(1000);
});

test('最小值', async () => {
    const res = await db.query('sysUser').min(
        {
            where: {
                money: {
                    gt: 0,
                },
            },
        },
        'money',
    );
    expect(res).toBe(100);
});
