/**
 * gesture.js — 從 MediaPipe Hands 的 21 點 landmarks 判斷「粗手勢」(設計 §2.5)。
 *
 * 注意:這是本專案唯一的「手勢語意」—— 跟核心互動(食指尖位置)刻意分開。
 * 使用者過去對「細手勢/骨架辨識」踩雷,故這裡只做最穩健的二元粗判:握拳。
 * 握拳是開/合的二元姿勢、抗噪性最高;再加「雙手同時 + 短暫停留」門檻,
 * 幾乎不會誤觸(見 app 的 pause 狀態機)。
 *
 * 純函式、無副作用、不依賴 DOM / Tone / MediaPipe class;方便單元測試。
 */

/** 兩點平方距離(免開根號;只比大小)。 */
function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * 判斷一隻手是否「握拳」。
 *
 * 原理(旋轉/尺度不變):手指彎曲時,指尖會捲向掌心 → 比起該指的 PIP 關節「更靠近手腕」;
 * 伸直時指尖是最遠端。故「指尖到手腕距離 < PIP 到手腕距離」= 該指收起。
 * 四指(食/中/無名/小)全收 = 明確握拳。**食指必須收**是關鍵:排除「比一」的演奏姿勢
 * (食指伸直瞄準時,中/無名/小指常是收的,但那不是握拳)。
 *
 * landmark 索引(MediaPipe Hands):0=wrist;食指 5/6/7/8、中指 9/10/11/12、
 * 無名 13/14/15/16、小指 17/18/19/20(各為 MCP/PIP/DIP/TIP)。拇指(1-4)不參與
 * (拇指收合判斷對握拳不必要且較不穩)。
 *
 * @param {Array<{x:number,y:number,z?:number}>} landmarks 21 點 normalized
 * @returns {boolean}
 */
export function isFist(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  const wrist = landmarks[0];
  if (!wrist) return false;
  // 指尖比 PIP 更靠近手腕 = 該指收起。
  const folded = (tip, pip) => dist2(landmarks[tip], wrist) < dist2(landmarks[pip], wrist);
  const index = folded(8, 6);
  const middle = folded(12, 10);
  const ring = folded(16, 14);
  const pinky = folded(20, 18);
  return index && middle && ring && pinky;
}

/**
 * 一組手是否「雙手握拳」(停止手勢的觸發條件)。
 * @param {Array<{landmarks?: Array<{x:number,y:number}>}>} hands handTracking 的 frame.hands
 * @returns {boolean} 偵測到 ≥2 隻手且皆握拳
 */
export function bothHandsFist(hands) {
  if (!hands || hands.length < 2) return false;
  let fists = 0;
  for (const hd of hands) {
    if (hd && hd.landmarks && isFist(hd.landmarks)) fists++;
  }
  return fists >= 2;
}
