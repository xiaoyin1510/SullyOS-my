# MiniMax T2A（HTTP）接入速记

> 来源：`https://platform.minimaxi.com/docs/api-reference/speech-t2a-http` 对应 OpenAPI。

## 1) 基础接口

- 主地址：`https://api.minimaxi.com/v1/t2a_v2`
- 文档提到备用地址：`https://api-bj.minimaxi.com/v1/t2a_v2`
- 音色查询接口：`https://api.minimaxi.com/v1/get_voice`（查询当前账号可用 voice_id）
- 鉴权：`Authorization: Bearer <API_KEY>`
- `Content-Type: application/json`

## 2) 最小可用请求（非流式）

```bash
curl -X POST 'https://api.minimaxi.com/v1/t2a_v2' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <API_KEY>' \
  -d '{
    "model": "speech-2.8-hd",
    "text": "你好，欢迎使用 MiniMax 文本转语音。",
    "stream": false,
    "voice_setting": {"voice_id": "male-qn-qingse"},
    "audio_setting": {"format": "mp3", "sample_rate": 32000, "bitrate": 128000, "channel": 1},
    "output_format": "url"
  }'
```

## 3) 关键字段

- 必填：`model`、`text`
- 常用：
  - `stream`：是否流式，默认 `false`
  - `voice_setting`：`voice_id/speed/vol/pitch/emotion`
  - `audio_setting`：`format/sample_rate/bitrate/channel`
  - `output_format`：`url` 或 `hex`（非流式可选，流式仅 hex）
- 文本上限：< 10000 字符；> 3000 时建议流式。

## 4) 返回值

- `data.audio`：音频内容（hex 或 URL，取决于 `output_format`）
- `extra_info`：时长、采样率、bitrate、计费字符数等
- `base_resp.status_code`：业务状态（`0` 为成功）
- `trace_id`：排障必备，建议全链路打日志。

## 5) 接入建议（工程实践）

1. **先跑非流式 + output_format=url**，减少你本地对 hex 解码和落盘处理负担。  
2. **文本切片**：按 200~500 字切片并发合成（保序拼接），避免长文本单次失败。  
3. **重试策略**：只对超时/限流错误做指数退避重试，鉴权与参数错误直接告警。  
4. **兜底音色**：主 `voice_id` 不可用时回落到系统默认音色。  
5. **可观测性**：记录 `trace_id`、模型、文本长度、耗时、状态码。  
6. **字幕需求**：需要句级时间戳时启用 `subtitle_enable`（仅非流式有效）。

## 6) 角色音色（可先做“音色 App”）

- 可以先做一个“角色音色管理”页：
  1) 拉取 `/v1/get_voice` 获取系统/复刻/文生音色；
  2) 角色上保存 `voice_id`；
  3) TTS 请求时直接把该 `voice_id` 写入 `voice_setting.voice_id`。
- 已有 voice_id 的用户可**直接跳过查询接口**，粘贴后即可调用合成。
