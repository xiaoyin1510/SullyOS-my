import { describe, it, expect } from 'vitest';
import { MemoryNodeDB, MemoryVectorDB, EventBoxDB, AnticipationDB } from './db';
import { exportMemoryPalace, importMemoryPalace, isMemoryPalaceExportFile } from './export';
import type { MemoryNode, EventBox, Anticipation, MemoryVector } from './types';

// fake-indexeddb 已通过 test-setup.ts 注入。
// 这组用例锁住记忆宫殿「导出 → 导入」往返：内容、向量、以及事件盒↔节点的内部引用
// 必须在重映射 ID 后依然自洽。

function makeNode(id: string, charId: string, over: Partial<MemoryNode> = {}): MemoryNode {
    return {
        id, charId,
        content: `记忆 ${id}`,
        room: 'living_room',
        tags: ['t1', 't2'],
        importance: 5,
        mood: 'happy',
        embedded: false,
        createdAt: 1000,
        lastAccessedAt: 1000,
        accessCount: 0,
        ...over,
    };
}

async function seedChar(charId: string) {
    // 两条节点 + 一个把它们装在一起的事件盒（n1 是 summary，n2 是 live 成员）
    const n1 = makeNode('n1', charId, { embedded: true, content: '整合回忆', isBoxSummary: true });
    const n2 = makeNode('n2', charId, { eventBoxId: 'box1', sourceId: 'n1' });
    await MemoryNodeDB.saveMany([n1, n2]);

    // n1 带向量（embedded=true）
    const vec: MemoryVector = {
        memoryId: 'n1', charId,
        vector: new Float32Array([0.1, 0.2, 0.3, 0.4]),
        dimensions: 4, model: 'test-embed',
    };
    await MemoryVectorDB.save(vec);

    const box: EventBox = {
        id: 'box1', charId, name: '一次出游', tags: ['trip'],
        summaryNodeId: 'n1', liveMemoryIds: ['n2'], archivedMemoryIds: [],
        compressionCount: 1, createdAt: 1000, updatedAt: 2000, lastCompressedAt: 2000,
    };
    await EventBoxDB.save(box);

    const ant: Anticipation = {
        id: 'ant1', charId, content: '想再去一次', status: 'active',
        createdAt: 1000, anchoredAt: null, resolvedAt: null,
    };
    await AnticipationDB.save(ant);
}

describe('记忆宫殿导出 / 导入', () => {
    it('带向量导出后再导入到新角色：内容、向量、事件盒引用都自洽', async () => {
        const src = 'char_src_1';
        await seedChar(src);

        const file = await exportMemoryPalace([{ id: src, name: '糯米机' }], { includeVectors: true });
        expect(isMemoryPalaceExportFile(file)).toBe(true);
        expect(file.includeVectors).toBe(true);
        expect(file.characters[0].counts).toMatchObject({ nodes: 2, eventBoxes: 1, anticipations: 1, vectors: 1 });
        // 导出节点带人类可读房间名
        expect((file.characters[0].nodes[0] as any).roomLabel).toBeTruthy();

        const dst = 'char_dst_1';
        const result = await importMemoryPalace(file, dst);
        expect(result).toMatchObject({ nodes: 2, eventBoxes: 1, anticipations: 1, vectors: 1 });

        const nodes = await MemoryNodeDB.getByCharId(dst);
        expect(nodes).toHaveLength(2);
        // ID 全部重生成（不再是 n1/n2），且 charId 改挂到目标角色
        expect(nodes.every(n => n.id !== 'n1' && n.id !== 'n2')).toBe(true);
        expect(nodes.every(n => n.charId === dst)).toBe(true);
        // roomLabel 这种导出附加字段不应落库
        expect(nodes.every(n => !('roomLabel' in n))).toBe(true);

        const boxes = await EventBoxDB.getByCharId(dst);
        expect(boxes).toHaveLength(1);
        const box = boxes[0];
        // 事件盒的 summary / live 引用指向的是导入后新生成的节点 ID，且确实存在
        const ids = new Set(nodes.map(n => n.id));
        expect(box.summaryNodeId && ids.has(box.summaryNodeId)).toBe(true);
        expect(box.liveMemoryIds.every(id => ids.has(id))).toBe(true);
        // 节点反向指回新盒
        const summaryNode = nodes.find(n => n.id === box.summaryNodeId)!;
        const liveNode = nodes.find(n => n.id === box.liveMemoryIds[0])!;
        expect(liveNode.eventBoxId).toBe(box.id);
        // sourceId 也按映射重写到 summary 节点
        expect(liveNode.sourceId).toBe(summaryNode.id);

        // 向量随 summary 节点一起迁移、改挂目标角色、内容不变
        const vecs = await MemoryVectorDB.getAllByCharId(dst);
        expect(vecs).toHaveLength(1);
        expect(vecs[0].memoryId).toBe(summaryNode.id);
        expect(Array.from(vecs[0].vector as Float32Array)).toEqual([
            expect.closeTo(0.1, 5), expect.closeTo(0.2, 5), expect.closeTo(0.3, 5), expect.closeTo(0.4, 5),
        ]);
        // 带向量的节点 embedded=true，另一条未带向量的 embedded=false
        expect(summaryNode.embedded).toBe(true);
        expect(liveNode.embedded).toBe(false);
    });

    it('不带向量导出：vectors 字段省略，导入后节点 embedded=false', async () => {
        const src = 'char_src_2';
        await seedChar(src);

        const file = await exportMemoryPalace([{ id: src, name: '糯米机' }], { includeVectors: false });
        expect(file.includeVectors).toBe(false);
        expect(file.characters[0].vectors).toBeUndefined();
        expect(file.characters[0].counts.vectors).toBe(0);

        const dst = 'char_dst_2';
        const result = await importMemoryPalace(file, dst);
        expect(result.vectors).toBe(0);

        const nodes = await MemoryNodeDB.getByCharId(dst);
        expect(nodes.every(n => n.embedded === false)).toBe(true);
        const vecs = await MemoryVectorDB.getAllByCharId(dst);
        expect(vecs).toHaveLength(0);
    });

    it('同一文件导入两次得到两份独立副本，不互相覆盖', async () => {
        const src = 'char_src_3';
        await seedChar(src);
        const file = await exportMemoryPalace([{ id: src, name: '糯米机' }], { includeVectors: true });

        const dst = 'char_dst_3';
        await importMemoryPalace(file, dst);
        await importMemoryPalace(file, dst);

        const nodes = await MemoryNodeDB.getByCharId(dst);
        expect(nodes).toHaveLength(4);
        const boxes = await EventBoxDB.getByCharId(dst);
        expect(boxes).toHaveLength(2);
        // 两个盒子的成员集合互不相交（各自指向自己那批新节点）
        const [b0, b1] = boxes;
        const members = (b: typeof b0) => [b.summaryNodeId, ...b.liveMemoryIds].filter(Boolean) as string[];
        const overlap = members(b0).filter(id => members(b1).includes(id));
        expect(overlap).toHaveLength(0);
    });

    it('非法文件被 isMemoryPalaceExportFile 拒绝，importMemoryPalace 抛错', async () => {
        expect(isMemoryPalaceExportFile({ foo: 'bar' })).toBe(false);
        expect(isMemoryPalaceExportFile(null)).toBe(false);
        await expect(importMemoryPalace({ type: 'nope' } as any, 'whatever')).rejects.toThrow();
    });
});
