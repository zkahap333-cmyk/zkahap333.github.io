//=============================================================================
// SmoothEightDir.js
//=============================================================================

/*:
 * @plugindesc v1.0.0 언더테일 스타일 8방향 스무스 이동 플러그인
 * WASD + 방향키 지원, 픽셀 단위 충돌, 벽 슬라이딩
 * @author Claude
 *
 * @param playerSpeed
 * @text 플레이어 이동 속도
 * @desc 픽셀/프레임 단위 이동 속도 (기본값: 4)
 * @type number
 * @decimals 1
 * @min 0.5
 * @max 20
 * @default 4
 *
 * @param collisionMargin
 * @text 충돌 판정 마진
 * @desc 픽셀 단위 충돌 마진. 작을수록 정밀함 (기본값: 4)
 * @type number
 * @min 1
 * @max 12
 * @default 4
 *
 * @param enableSliding
 * @text 벽 슬라이딩 활성화
 * @desc 벽에 대각선으로 부딪혔을 때 슬라이딩 여부
 * @type boolean
 * @default true
 *
 * @param slideThreshold
 * @text 슬라이딩 감도
 * @desc 슬라이딩이 발동되는 최소 속도 비율 (0.1 ~ 1.0)
 * @type number
 * @decimals 2
 * @min 0.1
 * @max 1.0
 * @default 0.5
 *
 * @help
 * ============================================================================
 * SmoothEightDir.js - 언더테일 스타일 8방향 스무스 이동
 * ============================================================================
 *
 * 기능:
 *  - WASD + 방향키 8방향 동시 입력 지원
 *  - 픽셀 단위 스무스 이동 (타일 단위 아님)
 *  - 벽 슬라이딩 (대각선 이동 중 벽에 닿으면 가능한 축으로 이동)
 *  - 픽셀 단위 정밀 충돌 처리
 *  - 대각선 이동 시 속도 보정 없음 (언더테일 스타일)
 *  - 플러그인 파라미터로 속도 조절 가능
 *
 * 조작:
 *  이동: WASD 또는 방향키 (동시 입력으로 대각선 이동)
 *
 * 주의:
 *  - 이벤트 기동 조건 "플레이어에 접촉" 은 타일 기반으로 동작합니다.
 *  - 이 플러그인은 Game_Player의 이동 로직을 완전히 대체합니다.
 * ============================================================================
 */

(function() {
    'use strict';

    //=========================================================================
    // 파라미터 로드
    //=========================================================================
    var parameters   = PluginManager.parameters('SmoothEightDir');
    var PLAYER_SPEED     = Number(parameters['playerSpeed']     || 4);
    var COLLISION_MARGIN = Number(parameters['collisionMargin'] || 4);
    var ENABLE_SLIDING   = (parameters['enableSliding'] !== 'false');
    var SLIDE_THRESHOLD  = Number(parameters['slideThreshold']  || 0.5);

    //=========================================================================
    // Input 확장 - WASD 키 추가
    //=========================================================================
    // RPG Maker MV의 Input.keyMapper 에 WASD 등록
    Input.keyMapper[87] = 'up_w';    // W
    Input.keyMapper[65] = 'left_a';  // A
    Input.keyMapper[83] = 'down_s';  // S
    Input.keyMapper[68] = 'right_d'; // D

    /**
     * 8방향 입력 벡터를 반환하는 헬퍼
     * @returns {{ x: number, y: number }}  각 성분 -1 / 0 / 1
     */
    function getInputVector() {
        var x = 0;
        var y = 0;

        // 상
        if (Input.isPressed('up')    || Input.isPressed('up_w'))    y = -1;
        // 하
        if (Input.isPressed('down')  || Input.isPressed('down_s'))  y =  1;
        // 좌
        if (Input.isPressed('left')  || Input.isPressed('left_a'))  x = -1;
        // 우
        if (Input.isPressed('right') || Input.isPressed('right_d')) x =  1;

        return { x: x, y: y };
    }

    //=========================================================================
    // 픽셀 단위 좌표 관리
    //=========================================================================
    // Game_CharacterBase 에 픽셀 좌표(_px, _py) 추가
    var _Game_CharacterBase_initMembers = Game_CharacterBase.prototype.initMembers;
    Game_CharacterBase.prototype.initMembers = function() {
        _Game_CharacterBase_initMembers.call(this);
        this._px = 0;   // 픽셀 X (타일 중앙 기준)
        this._py = 0;   // 픽셀 Y (타일 중앙 기준)
        this._pixelInitialized = false;
    };

    /**
     * 타일 좌표 → 픽셀 좌표 초기화
     */
    Game_CharacterBase.prototype.initPixelPos = function() {
        if (!this._pixelInitialized) {
            this._px = this._x * $gameMap.tileWidth();
            this._py = this._y * $gameMap.tileHeight();
            this._pixelInitialized = true;
        }
    };

    /**
     * 픽셀 좌표에서 타일 좌표(_x, _y)를 역산해 동기화
     */
    Game_CharacterBase.prototype.syncTileFromPixel = function() {
        var tw = $gameMap.tileWidth();
        var th = $gameMap.tileHeight();
        this._x = Math.round(this._px / tw);
        this._y = Math.round(this._py / th);
    };

    //=========================================================================
    // 픽셀 단위 통행 가능 판정
    //=========================================================================
    /**
     * 픽셀 좌표 (px, py) 에서 반경 margin 의 캐릭터가 통행 가능한지 반환
     * 4개 모서리 점을 타일 좌표로 변환해 passable 체크
     */
    Game_CharacterBase.prototype.isPixelPassable = function(px, py, margin) {
        var tw  = $gameMap.tileWidth();
        var th  = $gameMap.tileHeight();
        margin  = margin || COLLISION_MARGIN;

        // 충돌 박스 4 모서리 (픽셀)
        var points = [
            { x: px - tw / 2 + margin, y: py - th / 2 + margin },
            { x: px + tw / 2 - margin, y: py - th / 2 + margin },
            { x: px - tw / 2 + margin, y: py + th / 2 - margin },
            { x: px + tw / 2 - margin, y: py + th / 2 - margin }
        ];

        for (var i = 0; i < points.length; i++) {
            var tx = Math.floor(points[i].x / tw);
            var ty = Math.floor(points[i].y / th);

            // 맵 경계 체크
            if (!$gameMap.isValid(tx, ty)) return false;

            // 타일 통행 불가 체크 (4방향 모두 막힌 타일)
            if (!$gameMap.isPassable(tx, ty, 2) &&
                !$gameMap.isPassable(tx, ty, 4) &&
                !$gameMap.isPassable(tx, ty, 6) &&
                !$gameMap.isPassable(tx, ty, 8)) {
                return false;
            }
        }
        return true;
    };

    /**
     * 픽셀 이동 + 슬라이딩 처리
     * @param {number} vx  X 이동량 (픽셀)
     * @param {number} vy  Y 이동량 (픽셀)
     */
    Game_CharacterBase.prototype.movePixel = function(vx, vy) {
        var nx = this._px + vx;
        var ny = this._py + vy;

        if (this.isPixelPassable(nx, ny)) {
            // 그냥 이동 가능
            this._px = nx;
            this._py = ny;
        } else if (ENABLE_SLIDING) {
            // X축만 이동 시도
            if (Math.abs(vx) > Math.abs(PLAYER_SPEED) * SLIDE_THRESHOLD) {
                var nx2 = this._px + vx;
                if (this.isPixelPassable(nx2, this._py)) {
                    this._px = nx2;
                }
            }
            // Y축만 이동 시도
            if (Math.abs(vy) > Math.abs(PLAYER_SPEED) * SLIDE_THRESHOLD) {
                var ny2 = this._py + vy;
                if (this.isPixelPassable(this._px, ny2)) {
                    this._py = ny2;
                }
            }
        }
        // 타일 좌표 동기화
        this.syncTileFromPixel();
    };

    //=========================================================================
    // Game_Player - 이동 로직 재정의
    //=========================================================================
    var _Game_Player_initMembers = Game_Player.prototype.initMembers;
    Game_Player.prototype.initMembers = function() {
        _Game_Player_initMembers.call(this);
        this._smoothMoving = false;
        this._lastDirX = 0;
        this._lastDirY = 1; // 초기 방향: 아래
    };

    /**
     * 픽셀 좌표를 Sprite_Character 가 읽는 screenX/Y 에 반영
     * RPG Maker MV는 _realX, _realY (타일 단위 소수) 를 사용하므로
     * 이를 픽셀에서 역산한다.
     */
    var _Game_Player_update = Game_Player.prototype.update;
    Game_Player.prototype.update = function(sceneActive) {
        // 픽셀 좌표 초기화 (첫 프레임)
        this.initPixelPos();

        if (sceneActive && !$gameMessage.isBusy()) {
            this.updateSmoothMove();
        } else {
            this._smoothMoving = false;
        }

        // 부모 update 에서 이벤트 기동 등 처리 (이동 부분은 덮어씀)
        this.updateDashing();
        this.updateEncounterCount();
        this.updateVehicle();
        this.updateNonmoving(this._smoothMoving);

        // _realX/_realY 를 픽셀 좌표에서 동기화
        var tw = $gameMap.tileWidth();
        var th = $gameMap.tileHeight();
        this._realX = this._px / tw;
        this._realY = this._py / th;
        // 타일 좌표도 정수 동기화
        this._x = Math.round(this._realX);
        this._y = Math.round(this._realY);

        // 스크롤
        this.updateScroll(this._realX, this._realY);

        // 애니메이션 / 이동 상태
        this.updateAnimation();
    };

    /**
     * 실제 8방향 스무스 이동 처리
     */
    Game_Player.prototype.updateSmoothMove = function() {
        var input = getInputVector();
        var vx = input.x * PLAYER_SPEED;
        var vy = input.y * PLAYER_SPEED;

        if (vx !== 0 || vy !== 0) {
            this._smoothMoving = true;

            // 방향 기억 (스프라이트 방향 결정용)
            if (input.x !== 0) this._lastDirX = input.x;
            if (input.y !== 0) this._lastDirY = input.y;

            // RPG Maker 방향(2/4/6/8) 결정
            // Y 축 우선 (위/아래), 대각선이면 Y 방향
            var dir;
            if      (input.y < 0) dir = 8;
            else if (input.y > 0) dir = 2;
            else if (input.x < 0) dir = 4;
            else                  dir = 6;

            this.setDirection(dir);

            // 픽셀 이동
            this.movePixel(vx, vy);

            // 발걸음 카운트 (애니메이션 재생용)
            this._pattern = (this._pattern + 1) % this.maxPattern();

        } else {
            this._smoothMoving = false;
            // 정지 시 패턴 리셋
            this.resetStopCount();
        }
    };

    /**
     * 스크롤 업데이트 (realX/Y 기반)
     */
    Game_Player.prototype.updateScroll = function(lastRealX, lastRealY) {
        var x1 = lastRealX;
        var y1 = lastRealY;
        var x2 = this._realX;
        var y2 = this._realY;

        if (y2 > y1 && y2 > this.centerY()) {
            $gameMap.scrollDown(y2 - y1);
        }
        if (x2 < x1 && x2 < this.centerX()) {
            $gameMap.scrollLeft(x1 - x2);
        }
        if (x2 > x1 && x2 > this.centerX()) {
            $gameMap.scrollRight(x2 - x1);
        }
        if (y2 < y1 && y2 < this.centerY()) {
            $gameMap.scrollUp(y1 - y2);
        }
    };

    /**
     * 이동 중 여부 반환 (애니메이션 제어용)
     */
    var _Game_Player_isMoving = Game_Player.prototype.isMoving;
    Game_Player.prototype.isMoving = function() {
        return this._smoothMoving || _Game_Player_isMoving.call(this);
    };

    /**
     * 비이동 상태 업데이트 (이벤트 기동 등)
     * 원본 Game_Player.updateNonmoving 의 이벤트 트리거 부분만 유지
     */
    Game_Player.prototype.updateNonmoving = function(wasMoving) {
        if (!$gameMap.isEventRunning()) {
            if (wasMoving) {
                $gameParty.onPlayerWalk();
                this.checkEventTriggerHere([1, 2]);
                if ($gameMap.setupStartingEvent()) return;
            }
            if (this.triggerAction()) return;
            if (wasMoving) {
                this.updateEncounterCount();
            }
        }
    };

    //=========================================================================
    // Game_Map - 스크롤 위치를 픽셀 기준으로 부드럽게
    //=========================================================================
    // displayX/Y는 원래 실수 타일 단위이므로 _realX/Y 연동으로 자연스럽게 동작함

    //=========================================================================
    // 맵 전환 시 픽셀 좌표 재초기화
    //=========================================================================
    var _Game_Player_performTransfer = Game_Player.prototype.performTransfer;
    Game_Player.prototype.performTransfer = function() {
        _Game_Player_performTransfer.call(this);
        // 전환 후 픽셀 좌표를 타일 기준으로 재설정
        this._px = this._x * $gameMap.tileWidth();
        this._py = this._y * $gameMap.tileHeight();
        this._realX = this._x;
        this._realY = this._y;
        this._smoothMoving = false;
    };

    //=========================================================================
    // 세이브 / 로드 호환성
    //=========================================================================
    var _Game_Player_clearTransferInfo = Game_Player.prototype.clearTransferInfo;
    Game_Player.prototype.clearTransferInfo = function() {
        _Game_Player_clearTransferInfo.call(this);
        this._pixelInitialized = false; // 로드 후 재초기화 트리거
    };

    //=========================================================================
    // Sprite_Character - 픽셀 좌표 반영
    // (realX/Y를 이미 동기화했으므로 기본 screenX/Y 로직이 그대로 동작)
    //=========================================================================
    // 별도 오버라이드 불필요 — Game_CharacterBase.screenX/Y 는 _realX/_realY 사용

    //=========================================================================
    // 이벤트와의 픽셀 단위 접촉 판정 (선택적 강화)
    //=========================================================================
    /**
     * 플레이어와 이벤트 간 픽셀 거리 기반 접촉 판정
     */
    Game_Player.prototype.isCollidedWithEvents = function(x, y) {
        var events = $gameMap.eventsXyNt(x, y);
        return events.some(function(event) {
            return event.isNormalPriority();
        });
    };

    /**
     * 픽셀 수준에서 이벤트 트리거 기동 반경 체크
     * 기본 1타일 범위를 픽셀 오버랩으로 정밀화
     */
    var _Game_Player_startMapEvent = Game_Player.prototype.startMapEvent;
    Game_Player.prototype.startMapEvent = function(x, y, triggers, normal) {
        if (!$gameMap.isEventRunning()) {
            var tw = $gameMap.tileWidth();
            var th = $gameMap.tileHeight();
            $gameMap.eventsXy(x, y).forEach(function(event) {
                // 픽셀 거리 판정
                var ex = event._x * tw;
                var ey = event._y * th;
                var dx = Math.abs(this._px - ex);
                var dy = Math.abs(this._py - ey);
                if (dx < tw * 0.75 && dy < th * 0.75) {
                    if (event.isTriggerIn(triggers) &&
                        event.isNormalPriority() === normal) {
                        event.start();
                    }
                }
            }, this);
        }
    };

})();
