//=============================================================================
// MobileTouchpad.js
//=============================================================================

/*:
 * @plugindesc v1.0.0 모바일 전용 가상 조이스틱(터치패드)을 표시합니다. 이동 기능만 제공합니다.
 * @author Claude
 *
 * @param Pad Size
 * @text 패드 크기
 * @type number
 * @min 60
 * @max 300
 * @default 120
 * @desc 터치패드 외부 원의 반지름(px)
 *
 * @param Stick Size
 * @text 스틱 크기
 * @type number
 * @min 20
 * @max 150
 * @default 50
 * @desc 터치패드 내부 스틱 원의 반지름(px)
 *
 * @param Pad X
 * @text 패드 X 위치
 * @type number
 * @min 0
 * @default 100
 * @desc 터치패드 중심의 X 좌표(px)
 *
 * @param Pad Y
 * @text 패드 Y 위치
 * @type number
 * @min 0
 * @default 520
 * @desc 터치패드 중심의 Y 좌표(px). 기본값은 화면 하단 근처입니다.
 *
 * @param Pad Opacity
 * @text 패드 불투명도
 * @type number
 * @min 10
 * @max 255
 * @default 160
 * @desc 터치패드의 불투명도(10~255)
 *
 * @param Dead Zone
 * @text 데드존 반지름
 * @type number
 * @min 0
 * @max 50
 * @default 10
 * @desc 이 픽셀 이내의 입력은 무시합니다(오입력 방지)
 *
 * @help
 * ============================================================
 * MobileTouchpad - 모바일 전용 이동 터치패드
 * ============================================================
 * 모바일(터치) 환경에서만 화면 왼쪽 하단에 가상 조이스틱을
 * 표시합니다. PC/마우스 환경에서는 표시되지 않습니다.
 *
 * ● 사용법
 *   플러그인을 추가하기만 하면 됩니다. 별도 설정 불필요.
 *
 * ● 플러그인 매개변수로 위치/크기/불투명도를 조절할 수 있습니다.
 *
 * ● 조이스틱을 드래그하면 8방향 이동이 가능합니다.
 *
 * ============================================================
 */

(function () {
    'use strict';

    //----------------------------------------------------------------
    // 파라미터 로드
    //----------------------------------------------------------------
    var parameters   = PluginManager.parameters('MobileTouchpad');
    var PAD_RADIUS   = Number(parameters['Pad Size']    || 120);
    var STICK_RADIUS = Number(parameters['Stick Size']  || 50);
    var PAD_X        = Number(parameters['Pad X']       || 100);
    var PAD_Y        = Number(parameters['Pad Y']       || 520);
    var PAD_OPACITY  = Number(parameters['Pad Opacity'] || 160);
    var DEAD_ZONE    = Number(parameters['Dead Zone']   || 10);

    //----------------------------------------------------------------
    // 터치 환경 감지
    //----------------------------------------------------------------
    function isTouchDevice() {
        return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    }

    //----------------------------------------------------------------
    // 터치패드 Canvas 오버레이 생성
    //----------------------------------------------------------------
    var _touchpadCanvas   = null;
    var _touchpadCtx      = null;
    var _touchId          = null;   // 현재 추적 중인 touch identifier
    var _stickOffsetX     = 0;
    var _stickOffsetY     = 0;
    var _padActive        = false;

    // Input 방향키 상태를 직접 주입하기 위한 맵
    var _injectedKeys = { left: false, right: false, up: false, down: false };

    //----------------------------------------------------------------
    // Canvas 초기화
    //----------------------------------------------------------------
    function createTouchpadCanvas() {
        if (_touchpadCanvas) return;

        _touchpadCanvas = document.createElement('canvas');
        _touchpadCanvas.id = 'MobileTouchpad';
        _touchpadCanvas.width  = Graphics.width;
        _touchpadCanvas.height = Graphics.height;

        var style = _touchpadCanvas.style;
        style.position   = 'absolute';
        style.top        = '0';
        style.left       = '0';
        style.width      = '100%';
        style.height     = '100%';
        style.zIndex     = '999';
        style.pointerEvents = 'none'; // 캔버스 자체는 이벤트 통과
        style.touchAction = 'none';

        // PIXI/NW.js 캔버스 위에 얹기
        var container = document.getElementById('GameCanvas') ||
                        document.querySelector('canvas') ||
                        document.body;
        if (container.parentNode) {
            container.parentNode.insertBefore(_touchpadCanvas, container.nextSibling);
        } else {
            document.body.appendChild(_touchpadCanvas);
        }

        _touchpadCtx = _touchpadCanvas.getContext('2d');

        attachTouchListeners();
        drawPad();
    }

    //----------------------------------------------------------------
    // 그리기
    //----------------------------------------------------------------
    function drawPad() {
        if (!_touchpadCtx) return;
        var ctx = _touchpadCtx;
        ctx.clearRect(0, 0, _touchpadCanvas.width, _touchpadCanvas.height);

        var alpha = PAD_OPACITY / 255;

        // 스케일 보정 (화면 해상도 vs CSS 크기)
        var scaleX = Graphics.width  / _touchpadCanvas.width;  // 항상 1이지만 혹시 몰라서
        var cx = PAD_X;
        var cy = PAD_Y;

        // 외부 원 (베이스)
        ctx.beginPath();
        ctx.arc(cx, cy, PAD_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(80,80,80,' + (alpha * 0.5) + ')';
        ctx.fill();
        ctx.strokeStyle = 'rgba(200,200,200,' + alpha + ')';
        ctx.lineWidth = 3;
        ctx.stroke();

        // 십자 가이드
        ctx.strokeStyle = 'rgba(200,200,200,' + (alpha * 0.4) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx - PAD_RADIUS + 10, cy);
        ctx.lineTo(cx + PAD_RADIUS - 10, cy);
        ctx.moveTo(cx, cy - PAD_RADIUS + 10);
        ctx.lineTo(cx, cy + PAD_RADIUS - 10);
        ctx.stroke();

        // 내부 스틱
        var sx = cx + _stickOffsetX;
        var sy = cy + _stickOffsetY;
        ctx.beginPath();
        ctx.arc(sx, sy, STICK_RADIUS, 0, Math.PI * 2);
        var gradient = ctx.createRadialGradient(sx - STICK_RADIUS * 0.3, sy - STICK_RADIUS * 0.3, 2, sx, sy, STICK_RADIUS);
        gradient.addColorStop(0, 'rgba(255,255,255,' + alpha + ')');
        gradient.addColorStop(1, 'rgba(120,180,255,' + (alpha * 0.85) + ')');
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = 'rgba(180,220,255,' + alpha + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    //----------------------------------------------------------------
    // 터치 → 화면 좌표 변환
    //----------------------------------------------------------------
    function getTouchPos(touch) {
        var rect = _touchpadCanvas.getBoundingClientRect();
        var scaleX = _touchpadCanvas.width  / rect.width;
        var scaleY = _touchpadCanvas.height / rect.height;
        return {
            x: (touch.clientX - rect.left) * scaleX,
            y: (touch.clientY - rect.top)  * scaleY
        };
    }

    function distSq(x1, y1, x2, y2) {
        return (x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2);
    }

    //----------------------------------------------------------------
    // 입력 방향 갱신
    //----------------------------------------------------------------
    function updateDirection(dx, dy) {
        var dist = Math.sqrt(dx * dx + dy * dy);

        // 데드존 처리
        if (dist < DEAD_ZONE) {
            releaseAllKeys();
            return;
        }

        var angle = Math.atan2(dy, dx); // -π ~ π
        var deg   = angle * 180 / Math.PI; // -180 ~ 180

        // 8방향 분류 (45°씩)
        var left  = false, right = false, up = false, down = false;

        if (dist >= DEAD_ZONE) {
            // 수평 성분
            if (dx >  DEAD_ZONE) right = true;
            if (dx < -DEAD_ZONE) left  = true;
            // 수직 성분
            if (dy >  DEAD_ZONE) down  = true;
            if (dy < -DEAD_ZONE) up    = true;

            // 대각선 보정: 순수 상하좌우 45°±22.5° 이내이면 단축
            var absDeg = Math.abs(deg);
            if (absDeg < 22.5 || absDeg > 157.5) { up = false; down = false; }  // 순수 좌/우
            if (absDeg > 67.5 && absDeg < 112.5) { left = false; right = false; } // 순수 상/하
        }

        setKey('left',  left);
        setKey('right', right);
        setKey('up',    up);
        setKey('down',  down);
    }

    function releaseAllKeys() {
        setKey('left',  false);
        setKey('right', false);
        setKey('up',    false);
        setKey('down',  false);
    }

    //----------------------------------------------------------------
    // Input 객체에 키 주입
    //----------------------------------------------------------------
    var KEY_MAP = { left: 37, right: 39, up: 38, down: 40 };

    function setKey(dir, pressed) {
        if (_injectedKeys[dir] === pressed) return;
        _injectedKeys[dir] = pressed;

        var keyCode = KEY_MAP[dir];
        var keyName = Input.keyMapper[keyCode];

        if (pressed) {
            if (keyName && !Input._currentState[keyName]) {
                Input._currentState[keyName] = true;
            }
        } else {
            if (keyName) {
                Input._currentState[keyName] = false;
            }
        }
    }

    //----------------------------------------------------------------
    // 터치 이벤트 리스너
    //----------------------------------------------------------------
    function attachTouchListeners() {
        // 터치 이벤트는 document에 붙여서 게임 전체 캔버스에서 받음
        document.addEventListener('touchstart', onTouchStart, { passive: false });
        document.addEventListener('touchmove',  onTouchMove,  { passive: false });
        document.addEventListener('touchend',   onTouchEnd,   { passive: false });
        document.addEventListener('touchcancel',onTouchEnd,   { passive: false });
    }

    function onTouchStart(e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            var pos   = getTouchPos(touch);
            var d2    = distSq(pos.x, pos.y, PAD_X, PAD_Y);

            if (d2 <= PAD_RADIUS * PAD_RADIUS) {
                // 패드 영역 터치
                if (_touchId === null) {
                    _touchId    = touch.identifier;
                    _padActive  = true;
                    var dx = pos.x - PAD_X;
                    var dy = pos.y - PAD_Y;
                    var dist = Math.sqrt(dx*dx + dy*dy);
                    var maxD = PAD_RADIUS - STICK_RADIUS;
                    if (dist > maxD) { dx = dx / dist * maxD; dy = dy / dist * maxD; }
                    _stickOffsetX = dx;
                    _stickOffsetY = dy;
                    updateDirection(dx, dy);
                    drawPad();
                }
                e.preventDefault();
                break;
            }
        }
    }

    function onTouchMove(e) {
        if (_touchId === null) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
            var touch = e.changedTouches[i];
            if (touch.identifier !== _touchId) continue;

            var pos  = getTouchPos(touch);
            var dx   = pos.x - PAD_X;
            var dy   = pos.y - PAD_Y;
            var dist = Math.sqrt(dx*dx + dy*dy);
            var maxD = PAD_RADIUS - STICK_RADIUS;
            if (dist > maxD) { dx = dx / dist * maxD; dy = dy / dist * maxD; }
            _stickOffsetX = dx;
            _stickOffsetY = dy;
            updateDirection(dx, dy);
            drawPad();
            e.preventDefault();
            break;
        }
    }

    function onTouchEnd(e) {
        if (_touchId === null) return;
        for (var i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === _touchId) {
                _touchId      = null;
                _padActive    = false;
                _stickOffsetX = 0;
                _stickOffsetY = 0;
                releaseAllKeys();
                drawPad();
                break;
            }
        }
    }

    //----------------------------------------------------------------
    // Scene_Map 훅 — 맵 씬에서만 패드를 표시
    //----------------------------------------------------------------
    var _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function () {
        _Scene_Map_start.call(this);
        if (isTouchDevice()) {
            createTouchpadCanvas();
            if (_touchpadCanvas) _touchpadCanvas.style.display = 'block';
        }
    };

    var _Scene_Map_terminate = Scene_Map.prototype.terminate;
    Scene_Map.prototype.terminate = function () {
        _Scene_Map_terminate.call(this);
        releaseAllKeys();
        if (_touchpadCanvas) _touchpadCanvas.style.display = 'none';
    };

    //----------------------------------------------------------------
    // Graphics resize 대응 (화면 크기 변경 시 캔버스 재조정)
    //----------------------------------------------------------------
    var _Graphics_updateAllElements = Graphics._updateAllElements;
    Graphics._updateAllElements = function () {
        if (_Graphics_updateAllElements) _Graphics_updateAllElements.call(this);
        if (_touchpadCanvas) {
            _touchpadCanvas.width  = Graphics.width;
            _touchpadCanvas.height = Graphics.height;
            _touchpadCtx = _touchpadCanvas.getContext('2d');
            drawPad();
        }
    };

})();
