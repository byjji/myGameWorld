/**
 * 에셋 목록 — 어떤 그림이 있는지 선언하는 파일
 *
 * **그림을 추가할 때 고치는 곳은 여기 한 곳이다.**
 * 파일을 `assets/` 아래에 넣고 아래 목록에 한 줄 적으면 끝난다.
 * 게임 코드도 셸도 안 고친다.
 *
 * 지금은 비어 있다. 그래서 전부 임시 도형으로 그려진다 (js/chars.js, 각 게임의 배경).
 * 한 줄을 살리면 그 항목만 그림으로 바뀐다 — 캐릭터 하나씩 넣어도 된다.
 *
 * 규격과 넣는 법은 `assets/README.md`.
 *
 * JSON이 아니라 JS인 이유: 빌드 단계가 없고(PROJECT.md 2장), fetch를 쓰면
 * TV 브라우저에서 실패했을 때 원인이 파일인지 네트워크인지 가리기 어렵다.
 * 스크립트 태그로 실으면 안 실리는 순간 바로 드러난다.
 *
 * 문법 수준: ES5
 */
(function (global) {
  'use strict';

  var GP = global.GP || (global.GP = {});

  GP.assetManifest = {

    /* 캐릭터 스프라이트 시트.
       가로로 이어붙인 프레임 배열. poses가 자세별 프레임 번호를 가리킨다.

       fw · fh = 프레임 한 칸의 크기(픽셀).
       발밑 중앙이 기준점이므로 **캐릭터 발이 프레임 아래 끝에 닿게** 그린다. */
    chars: {
      // 아래 한 줄을 살리면 견본 스프라이트가 바로 화면에 나온다.
      // `python tools/make-sample-assets.py`로 다시 만들 수 있다.
      // 진짜 그림이 생기면 이 줄을 지우고 assets/chars/ 것으로 바꾼다.
      // lhat: { src: 'assets/sample/lhat.png', fw: 96, fh: 160,
      //         poses: { idle: 0, jump: 1, squat: 2, punch: 3 } },

      // lhat:   { src: 'assets/chars/lhat.png',   fw: 96, fh: 160,
      //           poses: { idle: 0, jump: 1, squat: 2, punch: 3 } },
      // mario:  { src: 'assets/chars/mario.png',  fw: 96, fh: 160,
      //           poses: { idle: 0, jump: 1, squat: 2, punch: 3 } },
      // luigi:  { src: 'assets/chars/luigi.png',  fw: 96, fh: 160, poses: { idle: 0 } },
      // peach:  { src: 'assets/chars/peach.png',  fw: 96, fh: 160, poses: { idle: 0 } },
      // bowser: { src: 'assets/chars/bowser.png', fw: 96, fh: 160, poses: { idle: 0 } },
      // toad:   { src: 'assets/chars/toad.png',   fw: 96, fh: 160, poses: { idle: 0 } }
    },

    /* 배경. 게임 id를 키로 쓴다.
       1280×720 한 장이면 drawImage 한 번으로 끝난다.

       로프 오르기(ropeclimb)만 세로로 흐른다 — 위아래로 이어져야 하므로
       **위 끝과 아래 끝이 맞물리게** 그린다. 높이는 720 이상으로. */
    bg: {
      // jumprope:   { src: 'assets/bg/jumprope.png' },
      // ropeclimb:  { src: 'assets/bg/ropeclimb.png' },
      // hammer:     { src: 'assets/bg/hammer.png' },
      // blockbreak: { src: 'assets/bg/blockbreak.png' }
    }
  };

})(window);
