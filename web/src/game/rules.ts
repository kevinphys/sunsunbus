// 遊戲規則參數（站間切分、三級開花、果實）。預設值在 shared/game.default.json，
// 與感測演算法參數（params.default.json）分開，調遊戲門檻不會影響事件偵測與 Python 對照。
import defaults from '../../../shared/game.default.json';
import type { EventType } from '../core/types';

export interface GameRules {
  segment: {
    /** 有站牌資料時，GPS 距站牌多近算「到站」(m) */
    stopRadiusM: number;
    /** 開始時 GPS 距最近站牌多近，就認定為上車站 (m) */
    boardRadiusM: number;
    /** 低於這個速度算停車 (m/s) */
    dwellSpeedMs: number;
    /** 沒有站牌資料時，停車超過幾秒算一次停靠 */
    dwellMinSec: number;
    /** 站間至少要這麼長 (m)；太短的會併入前一次停靠（例如在站前排隊、走走停停） */
    minSegmentM: number;
    /** 站間內 stable 取樣占比低於這個值，視為「沒量到」，不給等級 */
    minSegmentStableRatio: number;
    /** GPS 跳點：換算速度超過這個值的位移不計入里程 (m/s) */
    maxJumpSpeedMs: number;
    maxAccuracyM: number;
  };
  level: {
    /** 每類事件的點數。高加加速度預設 0：第一趟實測（656 後排）多半是路面顛簸，不該算在站間開得順不順 */
    weights: Record<EventType, number>;
    /** 嚴重事件門檻（峰值絕對值）：任一事件超過，該站間直接乾土 */
    severe: Record<EventType, number>;
    /** 點數 0 → 盛開；≤ 這個值 → 小花；更多 → 乾土 */
    sproutMaxPoints: number;
    /** 站間分數 = 100 − penaltyPerPoint × 點數（只給資料用，等級看點數） */
    penaltyPerPoint: number;
  };
  ride: {
    /** 有效的一趟至少要量到幾個站間 */
    minSegments: number;
    /** 整趟 stable 占比至少要多少 */
    minStableRatio: number;
    /** 每人每天最多幾顆果實 */
    dailyCap: number;
    /** 量到的站間中乾土占比 ≥ 這個值，果實改為探路果 */
    scoutDryShare: number;
    /** 缺水任務的倍數 */
    thirstMultiplier: number;
    fruitsPerReward: number;
    rewardNtd: number;
  };
  riding: {
    /** 不穩定多久切換成「小水滴在找支架」(s) */
    liftedAfterSec: number;
    /** 忘了按「我下車了」的保護：手機離開支架超過多久自動結束 (s) */
    autoEndUnstableSec: number;
    /** 有站牌資料時：離所有站牌都超過這個距離 (m) 持續 offRouteSec 秒，視為離開路線 */
    offRouteM: number;
    offRouteSec: number;
    /** 按「我下車了」時，GPS 距最近站牌多近，就認定為下車站 (m) */
    alightRadiusM: number;
  };
}

export const DEFAULT_RULES: GameRules = defaults as GameRules;
