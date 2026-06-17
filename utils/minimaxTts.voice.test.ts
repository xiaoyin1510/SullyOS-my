import { describe, it, expect } from 'vitest';
import { stripEmotionTags, cleanTextForTts, parseVoiceOutput, insertSpeechBreaks } from './minimaxTts';

describe('stripEmotionTags', () => {
  it('removes [emotion] / 【emotion】 tags anywhere, leaves prose', () => {
    expect(stripEmotionTags('[angry] 你怎么还不睡')).toBe(' 你怎么还不睡');
    expect(stripEmotionTags('喂？【calm】快去睡觉')).toBe('喂？快去睡觉');
    expect(stripEmotionTags('开头[happy]中间[sad]结尾')).toBe('开头中间结尾');
  });
  it('does not touch non-emotion brackets', () => {
    expect(stripEmotionTags('[备注] 还在')).toBe('[备注] 还在');
  });
});

describe('cleanTextForTts', () => {
  it('strips emotion tags and Chinese stage cues, keeps whitelisted sound tags', () => {
    const out = cleanTextForTts('[angry] 说话呀笨蛋(sighs)（叹气）');
    expect(out).not.toMatch(/\[angry\]/);
    expect(out).not.toContain('（叹气）');
    expect(out).toContain('(sighs)');
  });
  it('uses <语音> content (with attribute) when present', () => {
    expect(cleanTextForTts('显示文字<语音 emotion="happy">spoken (chuckle)</语音>')).toBe('spoken (chuckle)');
  });
});

describe('parseVoiceOutput', () => {
  it('extracts display, speech and a valid emotion attribute', () => {
    const r = parseVoiceOutput('外面的话<语音 emotion="sad">里面的话</语音>');
    expect(r.hasVoiceTag).toBe(true);
    expect(r.display).toBe('外面的话');
    expect(r.speech).toBe('里面的话');
    expect(r.emotion).toBe('sad');
  });
  it('drops an invalid emotion value', () => {
    expect(parseVoiceOutput('<语音 emotion="excited">嗨</语音>').emotion).toBeUndefined();
  });
  it('handles plain messages with no tag', () => {
    const r = parseVoiceOutput('就是一句话');
    expect(r.hasVoiceTag).toBe(false);
    expect(r.display).toBe('就是一句话');
  });
});

describe('insertSpeechBreaks', () => {
  it('caps pause length at 0.6s and inserts pause markers', () => {
    const out = insertSpeechBreaks('真的吗……好吧。');
    expect(out).toMatch(/<#0\.\d+#>/);
    const maxPause = Math.max(...[...out.matchAll(/<#([\d.]+)#>/g)].map(m => parseFloat(m[1])));
    expect(maxPause).toBeLessThanOrEqual(0.6);
  });
});
