import * as THREE from '../libs/three/three.module.js';

export class InputManager {
    constructor(renderer) {
        this.renderer = renderer;
        
        // Ввод для ПК (тесты)
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        
        // Ввод для VR
        this.controllers = [];
        this.xrGamepadLeft = null;
        this.xrGamepadRight = null;

        this.initDesktopInput();
        this.initVRInput();
    }

    initDesktopInput() {
        window.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
        window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    }

    initVRInput() {
        // Инициализируем контроллеры WebXR
        for (let i = 0; i < 2; i++) {
            const controller = this.renderer.xr.getController(i);
            const controllerGrip = this.renderer.xr.getControllerGrip(i);
            
            controller.addEventListener('connected', (e) => {
                const session = this.renderer.xr.getSession();
                if (session) {
                    const inputSource = e.data;
                    if (inputSource.gamepad) {
                        if (inputSource.handedness === 'left') {
                            this.xrGamepadLeft = inputSource.gamepad;
                        } else if (inputSource.handedness === 'right') {
                            this.xrGamepadRight = inputSource.gamepad;
                        }
                    }
                }
            });

            controller.addEventListener('disconnected', () => {
                this.xrGamepadLeft = null;
                this.xrGamepadRight = null;
            });
            
            this.controllers.push({ target: controller, grip: controllerGrip });
        }
    }

    update() {
        // Опрашиваем геймпады каждый кадр для плавного считывания осей стиков
        const session = this.renderer.xr.getSession();
        if (session && session.inputSources) {
            for (const source of session.inputSources) {
                if (source.gamepad) {
                    if (source.handedness === 'left') this.xrGamepadLeft = source.gamepad;
                    if (source.handedness === 'right') this.xrGamepadRight = source.gamepad;
                }
            }
        }
    }

    getLeftStick() {
        if (this.xrGamepadLeft && this.xrGamepadLeft.axes) {
            return { x: this.xrGamepadLeft.axes[2] || 0, y: this.xrGamepadLeft.axes[3] || 0 };
        }
        // Маппинг WASD для ПК
        let x = 0;
        let y = 0;
        if (this.keys['KeyW'] || this.keys['ArrowUp']) y = -1;
        if (this.keys['KeyS'] || this.keys['ArrowDown']) y = 1;
        if (this.keys['KeyA'] || this.keys['ArrowLeft']) x = -1;
        if (this.keys['KeyD'] || this.keys['ArrowRight']) x = 1;
        return { x, y };
    }

    getRightStick() {
        if (this.xrGamepadRight && this.xrGamepadRight.axes) {
            return { x: this.xrGamepadRight.axes[2] || 0, y: this.xrGamepadRight.axes[3] || 0 };
        }
        return { x: 0, y: 0 };
    }
}
