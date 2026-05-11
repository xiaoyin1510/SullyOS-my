/**
 * Memory Palace — 向量搜索 Web Worker
 *
 * 将 cosine similarity 的暴力计算搬到 Worker 线程，
 * 避免阻塞主线程 UI。
 *
 * 通信协议（支持并发多路复用）：
 *   主线程 → Worker:  { requestId, queryVector, vectors, threshold, topK }
 *   Worker → 主线程:  { requestId, results }
 *   主线程按 requestId 分发响应，避免并发 postMessage 时 onmessage 被后一个覆盖。
 */

self.onmessage = (e: MessageEvent) => {
    const { requestId, queryVector, vectors, threshold, topK } = e.data as {
        requestId: number;
        queryVector: number[] | Float32Array;
        vectors: { memoryId: string; vector: number[] | Float32Array }[];
        threshold: number;
        topK: number;
    };

    const qv = queryVector instanceof Float32Array ? queryVector : new Float32Array(queryVector);
    const qLen = qv.length;

    // Pre-compute query norm
    let qNorm = 0;
    for (let i = 0; i < qLen; i++) qNorm += qv[i] * qv[i];
    qNorm = Math.sqrt(qNorm);

    if (qNorm === 0) {
        (self as any).postMessage({ requestId, results: [] });
        return;
    }

    const scored: { memoryId: string; similarity: number }[] = [];

    // Decode any of (Float32Array / Uint8Array of float32 bytes / number[]) into
    // a Float32Array. Worker can't import shared utils without a build step, so
    // this is inlined.
    const decode = (v: any): Float32Array => {
        if (v instanceof Float32Array) return v;
        if (v instanceof Uint8Array) return new Float32Array(v.buffer, v.byteOffset, v.byteLength >>> 2);
        return new Float32Array(v);
    };

    for (const entry of vectors) {
        const bv = decode(entry.vector);

        // Inline cosine similarity with loop unrolling
        let dot = 0, bNorm = 0;
        const limit = qLen - (qLen % 4);
        let i = 0;
        for (; i < limit; i += 4) {
            const a0 = qv[i], a1 = qv[i+1], a2 = qv[i+2], a3 = qv[i+3];
            const b0 = bv[i], b1 = bv[i+1], b2 = bv[i+2], b3 = bv[i+3];
            dot += a0*b0 + a1*b1 + a2*b2 + a3*b3;
            bNorm += b0*b0 + b1*b1 + b2*b2 + b3*b3;
        }
        for (; i < qLen; i++) {
            dot += qv[i] * bv[i];
            bNorm += bv[i] * bv[i];
        }

        const denom = qNorm * Math.sqrt(bNorm);
        if (denom === 0) continue;

        const sim = dot / denom;
        if (sim >= threshold) {
            scored.push({ memoryId: entry.memoryId, similarity: sim });
        }
    }

    // Partial sort: only need topK, use selection for efficiency
    scored.sort((a, b) => b.similarity - a.similarity);

    (self as any).postMessage({ requestId, results: scored.slice(0, topK) });
};
