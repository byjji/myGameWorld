/**
 * NPC 러버밴딩 (PROJECT.md 6장)
 *
 * "AI"는 게임 용어로서의 NPC다. 머신러닝도 LLM도 없다. if문 몇 줄이 전부다.
 *
 * 여기서 지켜야 하는 것은 딱 하나다.
 * **압도적으로 이기면 질리고, 압도적으로 지면 폰을 던진다.**
 * 그래서 NPC는 "빠르기"가 아니라 "플레이어와의 거리"를 목표로 움직인다.
 *
 * PROJECT.md의 식은 이렇다.
 *
 *   npc.speed = player.speed * 0.85;
 *   if (remaining < 0.2) npc.speed *= 1.15;
 *
 * 그대로 쓰면 문제가 하나 생긴다. 플레이어가 한 번 크게 앞서면 배수만으로는 영영
 * 못 따라잡아 화면 밖으로 사라진다. 그래서 위 식을 기본 속도로 두고,
 * **목표 거리와의 오차를 비례 보정으로 더한다.** 배수는 그대로 살아 있고,
 * 벌어진 거리는 천천히 메워진다.
 *
 * 숫자는 전부 TUNE에 모아뒀다. 코드 문제가 아니라 조카 표정을 보고 정하는 값이다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var LP = global.LP || (global.LP = {});

  var TUNE = {
    FOLLOW:      0.85,   // 기본 추격 배수 (PROJECT.md 6장)
    BOOST:       1.15,   // 막판 추격 배수
    BOOST_AT:    0.20,   // 남은 거리가 이 비율 미만이면 가속

    PULL:        0.55,   // 목표 거리와의 오차를 메우는 세기(1/초). 클수록 고무줄이 팽팽하다
    LEASH:       0.22,   // 이 비율 이상 벌어지면 보정을 세 배로 — 화면 밖으로 못 나가게

    // 쿠파(페이스메이커)가 중반에 앞서는 거리와, 막판에 따라잡히는 정도.
    // 진행도 비율 단위다. 0.06 = 로프 전체의 6%.
    LEAD:        0.06,
    CATCH:       0.03,
    LEAD_FROM:   0.15,   // 출발 직후에는 나란히 간다
    LEAD_UNTIL:  0.75,   // 여기부터 앞선 거리를 줄이기 시작

    // 플레이어가 멈춰도 이만큼은 간다. 아니면 NPC가 굳어 보인다.
    // 조카가 아무것도 안 하는 90초 동안 NPC 혼자서라도 완주하도록 잡았다 —
    // 경주가 끝나야 결과 화면으로 넘어가고, 어른이 개입할 자리가 생긴다.
    MIN_SPEED:   0.30,
    MAX_SPEED:   3.0     // 플레이어가 폭주해도 이 이상은 안 간다
  };

  /**
   * 플레이어의 실시간 속도계.
   *
   * 초당 동작 수를 잰다. 창을 짧게 잡으면 한 번 쉬었을 때 0으로 떨어져
   * NPC가 그 자리에 멈춰 버린다. 6초는 스쿼트 두세 번이 들어가는 길이다.
   */
  function SpeedMeter(windowSec) {
    this.window = windowSec || 6;
    this.hits = [];
    this.t = 0;
  }

  SpeedMeter.prototype.tick = function (dt) {
    this.t += dt;
    var cut = this.t - this.window;
    while (this.hits.length && this.hits[0] <= cut) this.hits.shift();
  };

  SpeedMeter.prototype.hit = function () { this.hits.push(this.t); };

  /** 초당 동작 수. 시작 직후에는 창이 다 안 찼으므로 지나온 시간으로 나눈다. */
  SpeedMeter.prototype.rate = function () {
    var span = Math.min(this.t, this.window);
    if (span < 0.5) return 0;
    return this.hits.length / span;
  };

  SpeedMeter.prototype.reset = function () { this.hits = []; this.t = 0; };

  /**
   * 경주하는 NPC 하나.
   *
   * opts = {
   *   pacer:  true면 쿠파 역할 — 중반에 앞서고 막판에 따라잡힌다
   *   follow: 추격 배수. 주면 TUNE.FOLLOW 대신 쓴다
   *   unit:   동작 하나가 나아가는 거리(진행도 비율). 게임이 정한다
   * }
   */
  function Racer(opts) {
    opts = opts || {};
    this.pacer = !!opts.pacer;
    this.follow = opts.follow !== undefined ? opts.follow : TUNE.FOLLOW;
    this.unit = opts.unit || 1;
    this.pos = 0;            // 진행도 0~1
    this.speed = 0;          // 마지막 프레임의 속도 (진행도/초). 연출에 쓴다
  }

  /** 중반에 얼마나 앞설지. 막판에는 음수가 되어 플레이어에게 따라잡힌다. */
  Racer.prototype.leadAt = function (p) {
    if (!this.pacer) return 0;
    if (p < TUNE.LEAD_FROM) return 0;
    if (p < TUNE.LEAD_UNTIL) return TUNE.LEAD;
    var k = Math.min((p - TUNE.LEAD_UNTIL) / (1 - TUNE.LEAD_UNTIL), 1);
    return TUNE.LEAD * (1 - k) - TUNE.CATCH * k;
  };

  /**
   * 한 프레임 진행한다.
   *   dt        초
   *   rate      플레이어의 초당 동작 수 (SpeedMeter.rate())
   *   playerPos 플레이어 진행도 0~1
   */
  Racer.prototype.update = function (dt, rate, playerPos) {
    // 1. PROJECT.md의 식. 플레이어 속도의 몇 할로 간다.
    var v = rate * this.unit * this.follow;

    // 2. 막판 추격.
    if (1 - playerPos < TUNE.BOOST_AT) v *= TUNE.BOOST;

    // 3. 목표 거리와의 오차를 메운다. 이게 없으면 한 번 벌어진 거리가 영영 안 좁혀진다.
    var target = playerPos + this.leadAt(playerPos);
    var err = target - this.pos;
    var pull = TUNE.PULL;
    if (Math.abs(err) > TUNE.LEASH) pull *= 3;   // 화면 밖으로 나가려 하면 세게 당긴다
    v += err * pull;

    if (v < TUNE.MIN_SPEED * this.unit) v = TUNE.MIN_SPEED * this.unit;
    if (v > TUNE.MAX_SPEED * this.unit) v = TUNE.MAX_SPEED * this.unit;

    this.speed = v;
    this.pos += v * dt;
    if (this.pos > 1) this.pos = 1;
    return this.pos;
  };

  Racer.prototype.reset = function () { this.pos = 0; this.speed = 0; };

  LP.npc = {
    TUNE: TUNE,
    SpeedMeter: SpeedMeter,
    Racer: Racer
  };

})(window);
