/**
 * gesture.test.js — 握拳判斷(isFist / bothHandsFist)。
 *
 * 用合成 landmarks 驗證,不需相機:手朝上時,伸直指尖在上(離手腕遠)、
 * 收起指尖捲向掌心(離手腕近)。關鍵:演奏的「比一」姿勢(食指伸直)不可被當握拳。
 */

import { describe, it, expect } from 'vitest';
import { isFist, bothHandsFist } from '../src/gesture.js';

/**
 * 合成一隻「朝上」的手 21 點。各指可設 'ext'(伸直)或 'fold'(收起)。
 * y 越小越上(MediaPipe normalized);手腕在下方(y=0.9)。
 */
function makeHand({ index = 'ext', middle = 'ext', ring = 'ext', pinky = 'ext' } = {}) {
  const lm = new Array(21).fill(0).map(() => ({ x: 0.5, y: 0.5 }));
  lm[0] = { x: 0.5, y: 0.9 }; // wrist
  // 拇指(1-4):isFist 不使用,給合理佔位。
  lm[1] = { x: 0.4, y: 0.78 };
  lm[2] = { x: 0.36, y: 0.7 };
  lm[3] = { x: 0.33, y: 0.64 };
  lm[4] = { x: 0.3, y: 0.6 };
  const finger = (base, x, state) => {
    lm[base] = { x, y: 0.66 }; // MCP
    lm[base + 1] = { x, y: 0.52 }; // PIP
    lm[base + 2] = { x, y: 0.45 }; // DIP
    lm[base + 3] = { x, y: state === 'fold' ? 0.62 : 0.28 }; // TIP:收起捲回(近腕)/ 伸直(遠腕)
  };
  finger(5, 0.45, index);
  finger(9, 0.5, middle);
  finger(13, 0.55, ring);
  finger(17, 0.6, pinky);
  return lm;
}

describe('gesture — isFist', () => {
  it('張開的手(四指伸直)→ 不是握拳', () => {
    expect(isFist(makeHand())).toBe(false);
  });

  it('四指全收 → 握拳', () => {
    expect(isFist(makeHand({ index: 'fold', middle: 'fold', ring: 'fold', pinky: 'fold' }))).toBe(true);
  });

  it('「比一」演奏姿勢(食指伸直、其餘收)→ 不是握拳(關鍵:不誤判演奏)', () => {
    expect(isFist(makeHand({ index: 'ext', middle: 'fold', ring: 'fold', pinky: 'fold' }))).toBe(false);
  });

  it('只少收一指(小指伸直)→ 不算握拳(需四指全收)', () => {
    expect(isFist(makeHand({ index: 'fold', middle: 'fold', ring: 'fold', pinky: 'ext' }))).toBe(false);
  });

  it('防禦:null / 點數不足 → false', () => {
    expect(isFist(null)).toBe(false);
    expect(isFist([{ x: 0, y: 0 }])).toBe(false);
  });
});

describe('gesture — bothHandsFist(停止手勢觸發)', () => {
  const fist = () => makeHand({ index: 'fold', middle: 'fold', ring: 'fold', pinky: 'fold' });
  const open = () => makeHand();

  it('雙手皆握拳 → true', () => {
    expect(bothHandsFist([{ landmarks: fist() }, { landmarks: fist() }])).toBe(true);
  });

  it('一拳一張 → false', () => {
    expect(bothHandsFist([{ landmarks: fist() }, { landmarks: open() }])).toBe(false);
  });

  it('只有一隻手(即使握拳)→ false(需雙手)', () => {
    expect(bothHandsFist([{ landmarks: fist() }])).toBe(false);
  });

  it('沒有手 → false', () => {
    expect(bothHandsFist([])).toBe(false);
    expect(bothHandsFist(null)).toBe(false);
  });
});
