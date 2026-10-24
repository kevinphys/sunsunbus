// 搭乘中：沿用記錄器（感測、即時處理、寫入本機），另外即時切站間、判斷拿起手機與自動結束。
// 下車後用整趟批次結果重新切站間，存進這趟的 TripMeta.ride。
import type { Params } from '../core/params';
import type { TripInput } from '../core/trip';
import type { TripEvent } from '../core/types';
import { Recorder, type TripSetup } from '../app/recorder';
import type { TripMeta } from '../app/storage';
import type { GameRules } from '../game/rules';
import { StableIndex, StopTracker, buildSegments, segmentTrip, type RideSegment, type Stop } from '../game/segments';
import { evaluateRide, type RideResult } from '../game/ride';
import { addFruit, balance, fruitsToday, loadLedger } from './ledger';

export interface RideSetup extends TripSetup {
  direction?: number;
}

export interface LiveView {
  segments: RideSegment[];
  /** 已到站（結束）的站間數 */
  closed: number;
  lifted: boolean;
  calibrating: boolean;
  dwelling: boolean;
  nextStop: string | null;
  /** 正在站牌範圍內的那一站（有站牌資料時） */
  atStop: string | null;
  /** GPS 偵測到的上車站（有站牌資料時） */
  boardStop: string | null;
  /** 急煞、急加速、急轉彎的累計次數（高加加速度多半是路面顛簸，不觸發「晃了一下」） */
  shakes: number;
}

export class LiveRide {
  readonly recorder: Recorder;
  private tracker: StopTracker | null = null;
  private stable = new StableIndex();
  private events: TripEvent[] = [];
  private shakes = 0;
  private unstableSince: number | null = null;
  private lastT = 0;

  constructor(
    readonly setup: RideSetup,
    params: Params,
    private rules: GameRules,
    readonly stops: Stop[] | null,
    simTrip?: TripInput,
  ) {
    this.recorder = new Recorder(
      setup,
      params,
      {
        onSample: (s) => {
          this.tracker ??= new StopTracker(rules, stops, s.t);
          this.lastT = s.t;
          this.stable.add(s.t, s.stable);
          if (s.stable) this.unstableSince = null;
          else this.unstableSince ??= s.t;
        },
        onGps: (g) => {
          this.tracker ??= new StopTracker(rules, stops, g.t);
          this.tracker.push(g);
        },
        onEvent: (e) => {
          this.events.push(e);
          if (e.type !== 'high_jerk') this.shakes++;
        },
      },
      simTrip,
    );
    this.recorder.meta.direction = setup.direction;
  }

  start() {
    return this.recorder.start();
  }

  view(): LiveView {
    const tr = this.tracker;
    const lifted = this.unstableSince !== null && this.lastT - this.unstableSince > this.rules.riding.liftedAfterSec * 1000;
    if (!tr) return { segments: [], closed: 0, lifted, calibrating: true, dwelling: false, nextStop: null, atStop: null, boardStop: null, shakes: this.shakes };
    const endName = tr.nextStopName() ?? '下一站';
    const segments = buildSegments(tr.currentVisits(), this.lastT, tr.distM, this.stable, this.events, this.rules, endName);
    const last = segments.at(-1);
    if (last && last.tEnd === this.lastT) last.open = true;
    return {
      segments,
      closed: segments.filter((s) => !s.open).length,
      lifted,
      calibrating: this.recorder.live.last === null,
      dwelling: tr.isDwelling(),
      nextStop: tr.nextStopName(),
      atStop: tr.stops && tr.atStop() ? tr.stops[tr.atStop()!.index].name : null,
      boardStop: tr.boardStop(),
      shakes: this.shakes,
    };
  }

  /**
   * 忘了按「我下車了」的保護：離開路線或手機離開支架太久就自動結束。
   * 回傳原因與截止時間（之後的停靠不算，終點取截止前最後一站）。
   */
  autoEnd(): { reason: NonNullable<RideResult['autoEnded']>; cutoff: number } | null {
    const r = this.rules.riding;
    if (this.unstableSince !== null && this.lastT - this.unstableSince > r.autoEndUnstableSec * 1000) return { reason: 'unstable', cutoff: this.unstableSince };
    const tr = this.tracker;
    if (tr?.offRouteSince != null && tr.lastT - tr.offRouteSince > r.offRouteSec * 1000) return { reason: 'off_route', cutoff: tr.offRouteSince };
    return null;
  }

  /** 結束：批次處理整趟、切站間、算果實並記入帳本 */
  stop(auto?: { reason: NonNullable<RideResult['autoEnded']>; cutoff: number }): Promise<TripMeta> {
    return this.recorder.stop((meta, result, raw) => {
      const { segments, boardStop, alightStop } = segmentTrip(result.samples, result.events, raw.gps, this.stops, this.rules, auto?.cutoff);
      const ride = evaluateRide(segments, result.summary.stableRatio, fruitsToday(loadLedger()), this.rules, {
        stopSource: this.stops ? 'tdx' : 'dwell',
        autoEnded: auto?.reason,
      });
      ride.boardStop = boardStop;
      ride.alightStop = alightStop;
      if (this.stops && segments.length) {
        const names = new Set(segments.flatMap((s) => [s.fromName, s.toName]));
        ride.fullRoute = names.has(this.stops[0].name) && names.has(this.stops[this.stops.length - 1].name);
      }
      if (ride.valid) addFruit(ride.fruit, ride.fruitKind);
      ride.balanceAfter = balance(loadLedger());
      meta.ride = ride;
    });
  }
}
