//=============================================================================
// SmoothMove.js
//=============================================================================

/*:
 * @plugindesc 픽셀 단위 스무스 이동 (WASD + 방향키, 8방향, 벽 슬라이딩)
 * @author Claude
 *
 * @param speed
 * @text 이동 속도
 * @type number
 * @decimals 1
 * @min 0.5
 * @max 20
 * @default 4
 *
 * @param charW
 * @text 캐릭터 충돌 너비 (픽셀)
 * @type number
 * @min 1
 * @max 48
 * @default 20
 *
 * @param charH
 * @text 캐릭터 충돌 높이 (픽셀)
 * @type number
 * @min 1
 * @max 48
 * @default 30
 *
 * @help
 * WASD 또는 방향키로 8방향 픽셀 단위 스무스 이동.
 * 캐릭터 실제 크기에 맞는 충돌 박스 사용. 벽에 닿으면 슬라이딩.
 */

(function() {
    'use strict';

    var params = PluginManager.parameters('SmoothMove');
    var SPEED  = Number(params['speed'] || 4);
    var CHAR_W = Number(params['charW'] || 20);
    var CHAR_H = Number(params['charH'] || 30);

    // WASD 키 등록
    Input.keyMapper[87] = 'w';
    Input.keyMapper[65] = 'a';
    Input.keyMapper[83] = 's';
    Input.keyMapper[68] = 'd';

    // 입력 벡터 반환
    function getInputVec() {
        var x = 0, y = 0;
        if (Input.isPressed('up')    || Input.isPressed('w')) y = -1;
        if (Input.isPressed('down')  || Input.isPressed('s')) y =  1;
        if (Input.isPressed('left')  || Input.isPressed('a')) x = -1;
        if (Input.isPressed('right') || Input.isPressed('d')) x =  1;
        return { x: x, y: y };
    }

    //-------------------------------------------------------------------------
    // 픽셀 통행 판정
    //
    // RPG Maker MV 스프라이트 기준점 = 발 중앙 (하단 중심)
    // 따라서 (px, py) = 발 중앙 픽셀 좌표로 취급합니다.
    //
    //   ┌──────────┐  ← py - CHAR_H  (머리 위)
    //   │          │
    //   │ 충돌박스 │  너비: CHAR_W
    //   │          │
    //   └────●─────┘  ← py  (발, 기준점 ●)
    //
    // 4모서리를 타일 좌표로 변환해 통행 가능 여부 체크.
    //-------------------------------------------------------------------------
    function isPassable(px, py) {
        var tw = $gameMap.tileWidth();
        var th = $gameMap.tileHeight();
        var hw = CHAR_W / 2;

        var corners = [
            [px - hw, py - CHAR_H], // 좌상
            [px + hw, py - CHAR_H], // 우상
            [px - hw, py - 1],      // 좌하 (py 는 발 바깥이므로 -1)
            [px + hw, py - 1]       // 우하
        ];

        for (var i = 0; i < corners.length; i++) {
            var tx = Math.floor(corners[i][0] / tw);
            var ty = Math.floor(corners[i][1] / th);
            if (!$gameMap.isValid(tx, ty)) return false;
            // 4방향 모두 막혀있으면 통행 불가 타일
            if (!$gameMap.isPassable(tx, ty, 2) &&
                !$gameMap.isPassable(tx, ty, 4) &&
                !$gameMap.isPassable(tx, ty, 6) &&
                !$gameMap.isPassable(tx, ty, 8)) return false;
        }
        return true;
    }

    //-------------------------------------------------------------------------
    // 플레이어가 타일 중앙에 충분히 가까운지 판정
    // 이벤트 발동 및 애니메이션 정지에 사용
    //-------------------------------------------------------------------------
    var SNAP_THRESHOLD = 2; // 픽셀 단위 허용 오차

    function isNearTileCenter(px, py) {
        var tw = $gameMap.tileWidth();
        var th = $gameMap.tileHeight();
        var cx = Math.round((px - tw / 2) / tw) * tw + tw / 2;
        var cy = Math.round((py - th) / th) * th + th;
        return Math.abs(px - cx) <= SNAP_THRESHOLD &&
               Math.abs(py - cy) <= SNAP_THRESHOLD;
    }

    //-------------------------------------------------------------------------
    // Game_Player 이동 로직 교체
    //-------------------------------------------------------------------------
    var _initMembers = Game_Player.prototype.initMembers;
    Game_Player.prototype.initMembers = function() {
        _initMembers.call(this);
        this._px = 0;
        this._py = 0;
        this._pxReady = false;
        this._isSmoothing = false;
        // 이전 타일 좌표를 기억해 이벤트 중복 발동 방지
        this._lastEventX = -1;
        this._lastEventY = -1;
    };

    var _performTransfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        _performTransfer.call(this);
        this._pxReady = false;
        this._lastEventX = -1;
        this._lastEventY = -1;
    };

    var _update = Game_Player.prototype.update;
    Game_Player.prototype.update = function(sceneActive) {
        var tw = $gameMap.tileWidth();  // 48
        var th = $gameMap.tileHeight(); // 48

        // 픽셀 좌표 초기화 (첫 프레임 or 맵 전환 후)
        if (!this._pxReady) {
            this._px = this._x * tw + tw / 2;
            this._py = this._y * th + th;
            this._pxReady = true;
        }

        if (sceneActive && !$gameMessage.isBusy()) {
            this._updateSmoothMove();
        } else {
            this._isSmoothing = false;
        }

        this.updateDashing();
        this.updateEncounterCount();

        // ── [수정 1] 걷기 애니메이션 제어 ──────────────────────────────────
        // 입력이 없으면 이동 중이 아님을 명시적으로 전달해 애니메이션을 정지시킵니다.
        this.updateNonmoving(!this._isSmoothing);
        if (!this._isSmoothing) {
            // 애니메이션 카운터를 0으로 리셋하면 스프라이트가 정지 프레임으로 돌아갑니다.
            this._animationCount = 0;
        }
        this.updateAnimation();

        // _realX/Y 역산
        var prevRX = this._realX;
        var prevRY = this._realY;
        this._realX = this._px / tw - 0.5;
        this._realY = this._py / th - 1;
        this._x = Math.round(this._realX);
        this._y = Math.round(this._realY);

        this.updateScroll(prevRX, prevRY);

        // ── [수정 2] 타일 중앙 도달 시 이벤트 발동 ────────────────────────
        // 입력이 없고 타일 중앙 근처에 멈췄을 때 한 번만 checkEventTriggerHere 호출.
        if (!this._isSmoothing && isNearTileCenter(this._px, this._py)) {
            if (this._x !== this._lastEventX || this._y !== this._lastEventY) {
                this._lastEventX = this._x;
                this._lastEventY = this._y;
                this.checkEventTriggerHere([1, 2]);
            }
        }
    };

    Game_Player.prototype._updateSmoothMove = function() {
        var v = getInputVec();

        if (v.x === 0 && v.y === 0) {
            this._isSmoothing = false;
            this.resetStopCount();
            return;
        }

        this._isSmoothing = true;
        // 새로운 방향으로 이동 시작하면 이벤트 재판정을 위해 마지막 좌표 초기화
        this._lastEventX = -1;
        this._lastEventY = -1;

        // 스프라이트 방향 설정
        if      (v.y < 0) this.setDirection(8);
        else if (v.y > 0) this.setDirection(2);
        else if (v.x < 0) this.setDirection(4);
        else              this.setDirection(6);

        var vx = v.x * SPEED;
        var vy = v.y * SPEED;

        if (isPassable(this._px + vx, this._py + vy)) {
            this._px += vx;
            this._py += vy;
        } else {
            if (vx !== 0 && isPassable(this._px + vx, this._py)) this._px += vx;
            if (vy !== 0 && isPassable(this._px, this._py + vy)) this._py += vy;
        }
    };

    var _isMoving = Game_Player.prototype.isMoving;
    Game_Player.prototype.isMoving = function() {
        return this._isSmoothing || _isMoving.call(this);
    };

    // 카메라 스크롤
    Game_Player.prototype.updateScroll = function(prevRX, prevRY) {
        var x2 = this._realX, y2 = this._realY;
        if (y2 > prevRY && y2 > this.centerY()) $gameMap.scrollDown(y2 - prevRY);
        if (x2 < prevRX && x2 < this.centerX()) $gameMap.scrollLeft(prevRX - x2);
        if (x2 > prevRX && x2 > this.centerX()) $gameMap.scrollRight(x2 - prevRX);
        if (y2 < prevRY && y2 < this.centerY()) $gameMap.scrollUp(prevRY - y2);
    };

})();