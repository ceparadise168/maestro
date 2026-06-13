/**
 * coordinateMapper.test.js — coordinateMapper.js 單元測試(設計 §9)。
 *
 * 驗證(設計 §2.2 狀態機 + §2.3 防誤觸):
 *  - 契約形狀(update / reset)。
 *  - 指尖在死區內 → REST / zone=null;指尖移到某塊 → ACTIVE + 正確 zone + changed。
 *  - 邊界附近抖動(< hysteresis)→ zone 不變、changed=false;超過 hysteresis 才換。
 *  - 死區進出(REST↔ACTIVE)的 changed 旗標。
 *  - 左右分盤(§2.1):依「畫面左右位置」分盤(畫面為水平鏡像);同半多指取最靠近圓心者。
 *  - 左盤、右盤各自獨立狀態機。
 *
 * 測試座標策略:
 *  - 盤幾何在「設計空間」(config.DISKS,1280×720),故 update 的 viewport 一律傳 DESIGN_VIEW,
 *    使 normalized→像素換算落在盤所在的設計空間(見回報的 geometry/契約假設)。
 *  - 用 geometry.polar 由 (盤, 角度, 半徑) 算出「設計空間像素」,再反算成 raw normalized:
 *    mapper 會對 x 做鏡像 (1-rawX)*W,故這裡 rawX = 1 - px/W、rawY = py/H,確保來回鏡像對得上。
 *  - One-Euro 平滑會有收斂延遲:測「穩態」時連餵多幀讓濾波器收斂後再斷言。
 */
import { describe, it, expect } from 'vitest';
import { createMapper } from '../src/coordinateMapper.js';
import { DISKS, KEYBOARD, DESIGN_VIEW, SLOTS, HYSTERESIS_DEG } from '../src/config.js';
import { polar, keyBoundsX } from '../src/geometry.js';

const W = DESIGN_VIEW.width;
const H = DESIGN_VIEW.height;
const STEP = 360 / SLOTS; // 45°

/** 由 (盤, 角度°, 半徑px) 產生一個「未鏡像的 raw normalized」指尖。 */
function tipAt(disk, deg, r) {
  const p = polar(disk.cx, disk.cy, r, deg); // 設計空間像素
  return { x: 1 - p.x / W, y: p.y / H };     // 反鏡像 → raw normalized
}

/** 旋律琴鍵第 k 鍵中央 x(設計空間像素)。 */
function keyCenterX(k) {
  const b = keyBoundsX(k, KEYBOARD);
  return (b.x0 + b.x1) / 2;
}
/** 琴鍵第 k 鍵「壓下發聲」位置(線下)→ 未鏡像 raw normalized。 */
function kbPress(k) {
  return { x: 1 - keyCenterX(k) / W, y: (KEYBOARD.pressY + 12) / H };
}
/** 琴鍵第 k 鍵「線上方瞄準(不發聲)」位置 → 未鏡像 raw normalized。 */
function kbHover(k) {
  return { x: 1 - keyCenterX(k) / W, y: (KEYBOARD.releaseY - 24) / H };
}

/** slot k 的角度中心(度)。 */
function slotCenterDeg(k) {
  return k * STEP + STEP / 2;
}

/** 餵同一組 tips n 幀,回傳最後一幀結果(讓 One-Euro 收斂到穩態)。 */
function settle(mapper, tips, frames = 12) {
  let res;
  for (let i = 0; i < frames; i++) res = mapper.update(tips, DESIGN_VIEW);
  return res;
}

const midR = (DISKS.L.rIn + DISKS.L.rOut) / 2; // 塊中段半徑,穩穩落在 donut 內

describe('coordinateMapper — contract', () => {
  it('createMapper returns update + reset', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    expect(typeof mapper.update).toBe('function');
    expect(typeof mapper.reset).toBe('function');
  });

  it('update returns L and R disk states each frame', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = mapper.update([], DESIGN_VIEW);
    expect(res).toHaveProperty('L');
    expect(res).toHaveProperty('R');
    for (const d of [res.L, res.R]) {
      expect(d).toHaveProperty('state');
      expect(d).toHaveProperty('zone');
      expect(d).toHaveProperty('changed');
    }
  });
});

describe('coordinateMapper — REST / no hands', () => {
  it('no tips → both disks REST, zone null, not present', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = mapper.update([], DESIGN_VIEW);
    expect(res.L.state).toBe('REST');
    expect(res.L.zone).toBe(null);
    expect(res.L.present).toBe(false);
    expect(res.R.state).toBe('REST');
    expect(res.R.zone).toBe(null);
    expect(res.R.present).toBe(false);
  });

  it('tip inside the deadzone (center) → present but REST, zone null', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    // 半徑 < rIn(嚴格小於)→ 死區內
    const tip = tipAt(DISKS.L, 0, DISKS.L.rIn * 0.5);
    const res = settle(mapper, [tip]);
    expect(res.L.present).toBe(true);
    expect(res.L.state).toBe('REST');
    expect(res.L.zone).toBe(null);
  });
});

describe('coordinateMapper — ACTIVE / zone mapping (left disk = chords)', () => {
  it('tip out to slot 0 (up) → ACTIVE zone 0, changed on entry', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = settle(mapper, [tipAt(DISKS.L, slotCenterDeg(0), midR)]);
    expect(res.L.state).toBe('ACTIVE');
    expect(res.L.zone).toBe(0);
  });

  it('REST → ACTIVE transition sets changed=true exactly on the transition frame', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    // 第一幀就從死區外進塊 2;第一幀 One-Euro 無歷史 → 直接近 raw,應立即 ACTIVE。
    const first = mapper.update([tipAt(DISKS.L, slotCenterDeg(2), midR)], DESIGN_VIEW);
    expect(first.L.state).toBe('ACTIVE');
    expect(first.L.zone).toBe(2);
    expect(first.L.changed).toBe(true);
    // 維持同塊 → changed 變 false
    const next = mapper.update([tipAt(DISKS.L, slotCenterDeg(2), midR)], DESIGN_VIEW);
    expect(next.L.changed).toBe(false);
    expect(next.L.zone).toBe(2);
  });

  it('each of the 8 slots maps to its index (CW from up)', () => {
    for (let k = 0; k < SLOTS; k++) {
      const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
      const res = settle(mapper, [tipAt(DISKS.L, slotCenterDeg(k), midR)]);
      expect(res.L.zone).toBe(k);
      expect(res.L.state).toBe('ACTIVE');
    }
  });

  it('ACTIVE(k) → REST when returning to deadzone sets changed=true', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    settle(mapper, [tipAt(DISKS.L, slotCenterDeg(3), midR)]);
    const back = settle(mapper, [tipAt(DISKS.L, 0, DISKS.L.rIn * 0.3)]);
    expect(back.L.state).toBe('REST');
    expect(back.L.zone).toBe(null);
    // 最後一幀已穩態(前一幀就回到 REST),所以單看 changed 不可靠;改驗單幀轉換
    const m2 = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    settle(m2, [tipAt(DISKS.L, slotCenterDeg(3), midR)]);
    const t = m2.update([tipAt(DISKS.L, 0, DISKS.L.rIn * 0.3)], DESIGN_VIEW);
    expect(t.L.state).toBe('REST');
    expect(t.L.changed).toBe(true);
  });
});

describe('coordinateMapper — hysteresis (boundary anti-jitter, §2.3.2)', () => {
  it('crossing a boundary by LESS than hysteresis does NOT switch zone', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    // 先穩定在塊 1 中心
    let res = settle(mapper, [tipAt(DISKS.L, slotCenterDeg(1), midR)]);
    expect(res.L.zone).toBe(1);
    // 邊界 1|2 在 90°;越界進塊 2 側,但只多越 HYSTERESIS_DEG-2 度(< margin)→ 不該換
    const justOver = 90 + (HYSTERESIS_DEG - 2);
    res = settle(mapper, [tipAt(DISKS.L, justOver, midR)]);
    expect(res.L.zone).toBe(1); // 仍黏在 1
    expect(res.L.changed).toBe(false);
  });

  it('crossing a boundary by MORE than hysteresis DOES switch zone', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    settle(mapper, [tipAt(DISKS.L, slotCenterDeg(1), midR)]);
    // 越界進塊 2 側,多越 HYSTERESIS_DEG+5 度(> margin)→ 應換到 2
    const wellOver = 90 + (HYSTERESIS_DEG + 5);
    const res = settle(mapper, [tipAt(DISKS.L, wellOver, midR)]);
    expect(res.L.zone).toBe(2);
  });

  it('jittering back and forth across a boundary within hysteresis never flips the zone', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    settle(mapper, [tipAt(DISKS.L, slotCenterDeg(2), midR)]); // 安定在塊 2
    const boundary = 90; // 2|1 共用邊界
    const zones = [];
    for (let i = 0; i < 10; i++) {
      // 在邊界兩側小幅來回,皆 < hysteresis
      const deg = boundary + (i % 2 === 0 ? (HYSTERESIS_DEG - 3) : -(HYSTERESIS_DEG - 3));
      const r = mapper.update([tipAt(DISKS.L, deg, midR)], DESIGN_VIEW);
      zones.push(r.L.zone);
    }
    // 全程不得亂跳:只能是原本的 2
    expect(zones.every((z) => z === 2)).toBe(true);
  });
});

describe('coordinateMapper — left/right disk split (§2.1, mirrored view)', () => {
  it('a tip in the screen-LEFT half drives L; R stays REST', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = settle(mapper, [tipAt(DISKS.L, slotCenterDeg(0), midR)]);
    expect(res.L.present).toBe(true);
    expect(res.L.state).toBe('ACTIVE');
    expect(res.R.present).toBe(false);
    expect(res.R.state).toBe('REST');
  });

  it('a tip in the screen-RIGHT half (pressed) drives R keyboard; L stays REST', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = settle(mapper, [kbPress(4)]);
    expect(res.R.present).toBe(true);
    expect(res.R.state).toBe('ACTIVE');
    expect(res.R.zone).toBe(4);
    expect(res.L.present).toBe(false);
    expect(res.L.state).toBe('REST');
  });

  it('two tips (one per half) drive chord disk + melody keyboard independently', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const tips = [tipAt(DISKS.L, slotCenterDeg(1), midR), kbPress(5)];
    const res = settle(mapper, tips);
    expect(res.L.state).toBe('ACTIVE');
    expect(res.L.zone).toBe(1);
    expect(res.R.state).toBe('ACTIVE');
    expect(res.R.zone).toBe(5);
  });

  it('two tips in the SAME half → pick the one nearest that disk center', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    // 兩指都在畫面左半:一個落在塊 0(midR,離圓心遠),一個更靠近圓心(死區邊緣外一點點,塊 3)
    const far = tipAt(DISKS.L, slotCenterDeg(0), DISKS.L.rOut * 0.95); // 較遠
    const near = tipAt(DISKS.L, slotCenterDeg(3), DISKS.L.rIn + 4);    // 較近圓心
    const res = settle(mapper, [far, near]);
    // 取最靠近圓心者 → 應反映塊 3,而非塊 0
    expect(res.L.zone).toBe(3);
  });
});

describe('coordinateMapper — 旋律琴鍵 + 演奏線(§2.2 melody, 2026-06-13)', () => {
  it('線上方 hover → REST(不發聲)、aim = 該鍵、present', () => {
    const m = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = settle(m, [kbHover(3)]);
    expect(res.R.present).toBe(true);
    expect(res.R.state).toBe('REST');
    expect(res.R.zone).toBe(null);
    expect(res.R.aim).toBe(3);
  });

  it('壓過演奏線 → ACTIVE、zone = 該鍵(發聲)', () => {
    const m = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = settle(m, [kbPress(3)]);
    expect(res.R.state).toBe('ACTIVE');
    expect(res.R.zone).toBe(3);
  });

  it('壓下後水平移到別鍵 → zone 鎖定不變(無經過誤觸)', () => {
    const m = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    settle(m, [kbHover(2)]);
    settle(m, [kbPress(2)]); // 壓下鍵 2
    // 維持壓下(y 仍過線),x 平移到鍵 5
    const moved = settle(m, [{ x: 1 - keyCenterX(5) / W, y: (KEYBOARD.pressY + 12) / H }]);
    expect(moved.R.state).toBe('ACTIVE');
    expect(moved.R.zone).toBe(2); // 鎖定鍵 2,不因水平移動換音
  });

  it('抬回線上 → REST、aim 跟著新位置', () => {
    const m = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    settle(m, [kbPress(4)]);
    const lifted = settle(m, [kbHover(6)]);
    expect(lifted.R.state).toBe('REST');
    expect(lifted.R.zone).toBe(null);
    expect(lifted.R.aim).toBe(6);
  });

  it('演奏線雙閾值:y 落在 release~press 之間維持上一狀態(不狂發)', () => {
    const m = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    settle(m, [kbPress(3)]); // 先壓下
    const bandY = (KEYBOARD.releaseY + KEYBOARD.pressY) / 2; // 遲滯帶內
    const mid = settle(m, [{ x: 1 - keyCenterX(3) / W, y: bandY / H }]);
    expect(mid.R.state).toBe('ACTIVE'); // 尚未抬過 releaseY → 維持發聲
    expect(mid.R.zone).toBe(3);
  });

  it('右半無手 → R REST、不 present', () => {
    const m = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const res = settle(m, [tipAt(DISKS.L, slotCenterDeg(0), midR)]); // 只有左手
    expect(res.R.present).toBe(false);
    expect(res.R.state).toBe('REST');
  });
});

describe('coordinateMapper — reset', () => {
  it('reset clears state so next ACTIVE entry reports changed=true again', () => {
    const mapper = createMapper({ disks: DISKS, keyboard: KEYBOARD });
    const a = mapper.update([tipAt(DISKS.L, slotCenterDeg(2), midR)], DESIGN_VIEW);
    expect(a.L.changed).toBe(true);
    mapper.update([tipAt(DISKS.L, slotCenterDeg(2), midR)], DESIGN_VIEW); // changed=false now
    mapper.reset();
    const b = mapper.update([tipAt(DISKS.L, slotCenterDeg(2), midR)], DESIGN_VIEW);
    expect(b.L.changed).toBe(true); // reset 後重新視為新進入
  });
});
