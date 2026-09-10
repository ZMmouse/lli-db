import { isPlainObject } from 'lodash';
import { db } from './test-database';

test('测试全类型数据单条插入', async () => {
    const entity = db.query('testAllField');
    const res = await entity.create({
            data: {
                name: '测试',
                desc: '测试数据',
                content: '测试内容',
                like: 100,
                price: 10,
                money: 6,
                enabled: true,
                labels: ['测试'],
                category: '小说',
                author: '1',
                color: '#fff',
                meta: {
                    name: '测试',
                    desc: '测试数据',
                },
                images: [
                    {
                        url: 'https://www.baidu.com',
                        name: 'clone-user',
                    },
                ],
                password: 'pwd',
            },
    });
    expect(!!res.id).toBe(true);
});

test('insert single', async () => {
    const entity = db.query('sysUser');
    const res = await entity.create({
        data: {
            username: 'Test01',
            nickname: 'Test01',
            password: 'pwd',
            email: 'test01@example.com',
            phone: '12345678901',
            createdBy: '1',
            updateBy: '1',
            // role: ['1', '2'],
        },
    });

    expect(!!res.id).toBe(true);
});

test('insert single with multi option', async () => {
    const entity = db.query('sysUser');
    const res = await entity.create({
        data: {
            username: 'Test02',
            nickname: 'Test02',
            password: 'pwd',
            email: 'test02@example.com',
            phone: '12345678901',
            createdBy: '1',
            updateBy: '1',
            role: ['1', '2'],
        },
    });

    expect(!!res.id).toBe(true);
});

test('insert with many', async () => {
    const entity = db.query('sysUser');
    const res = await entity.createMany({
        data: [
            {
                username: 'Test03',
                nickname: 'Test03',
                password: 'pwd',
                email: 'test03@example.com',
                phone: '12345678901',
                createdBy: '1',
                updateBy: '1',
                role: ['1', '2'],
            },
            {
                username: 'Test04',
                nickname: 'Test04',
                password: 'pwd',
                email: 'test04@example.com',
                phone: '12345678901',
                createdBy: '1',
                updateBy: '1',
                role: ['1', '2'],
            },
        ],
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length === 2).toBe(true);
});

test('insert single and child', async () => {
    const entity = db.query('sysUser');
    const res = await entity.create({
        data: {
            username: 'Test05',
            nickname: 'Test05',
            password: 'pwd',
            email: 'test05@example.com',
            phone: '12345678901',
            createdBy: '1',
            updateBy: '1',
            role: ['1', '2'],
            sysUserFriendList: [
                {
                    friendId: '1',
                    isTop: 1,
                },
                {
                    friendId: '2',
                    isTop: 1,
                },
            ],
        },
    });

    expect(!!res.id).toBe(true);
});

test('insert many and child', async () => {
    const entity = db.query('sysUser');
    const res = await entity.createMany({
        data: [
            {
                username: 'Test06',
                nickname: 'Test06',
                password: 'pwd',
                email: 'test06@example.com',
                phone: '12345678901',
                createdBy: '1',
                updateBy: '1',
                role: ['1', '2'],
                sysUserFriendList: [
                    {
                        friendId: '1',
                        isTop: 1,
                    },
                    {
                        friendId: '2',
                        isTop: 1,
                    },
                ],
            },
            {
                username: 'Test07',
                nickname: 'Test07',
                password: 'pwd',
                email: 'test07@example.com',
                phone: '12345678901',
                createdBy: '1',
                updateBy: '1',
                role: ['1', '2'],
                sysUserFriendList: [
                    {
                        friendId: '1',
                        isTop: 1,
                    },
                    {
                        friendId: '2',
                        isTop: 1,
                    },
                ],
            },
        ],
    });

    expect(Array.isArray(res)).toBe(true);
    expect(res.length === 2).toBe(true);
});

test('克隆数据', async () => {
    const entity = db.query('sysUser');
    const res = await entity.clone('1', {
        data: {
            username: 'clone-user',
            nickname: 'clone-user',
            money: 0,
        },
    });

    expect(res.id !== '1').toBe(true);
    expect(res.username === 'clone-user').toBe(true);
});

test('全类型测试', async () => {
    const entity = db.query('testAllField');
    const res = await entity.create({
        populate: {
            author: ['nickname', 'id', 'username'],
        },
        data: {
            name: '吃云竟然可以修仙！',
            desc: '吃天上的云竟然可以修仙！',
            content: 0,
            like: 22,
            price: 23,
            money: 99,
            enabled: true,
            labels: ['玄幻', '修仙'],
            category: '小说',
            author: '2',
            color: '#fff',
            meta: {
                name: '吃云竟然可以修仙',
                desc: '吃天上的云竟然可以修仙',
            },
            images: [
                {
                    url: 'https://www.baidu.com',
                    name: 'clone-user',
                },
            ],
        },
    });

    expect(!!res.id).toBe(true);
    expect(res.name === '吃云竟然可以修仙！').toBe(true);
    expect(isPlainObject(res.meta)).toBe(true);
    expect(Array.isArray(res.images)).toBe(true);
});
