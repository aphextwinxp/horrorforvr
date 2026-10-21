import * as THREE from '../libs/three/three.module.js';

export class Player {
    constructor(scene, camera, inputManager, config) {
        this.scene = scene;
        this.camera = camera;
        this.input = inputManager;
        this.config = config;

        // Контейнер игрока (риг), чтобы двигать камеру в WebXR
        this.cameraRig = new THREE.Group();
        this.cameraRig.position.set(0, 0, 5); // Стартовая позиция возле АЗС
        this.scene.add(this.cameraRig);
        this.cameraRig.add(this.camera);

        // Настройки перемещения
        this.speed = 2.5; // Скорость ходьбы ночной смены
        this.snapTurnAngle = THREE.MathUtils.degToRad(45); // Угол поворота
        this.snapCooldown = false;
        
        this.createVignette();
    }

    createVignette() {
        // Создаем VR-виньетку (черное кольцо перед глазами при движении)
        const geometry = new THREE.RingGeometry(0.8, 2, 32);
        const material = new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.0,
            depthTest: false,
            depthWrite: false
        });
        this.vignette = new THREE.Mesh(geometry, material);
        this.vignette.position.set(0, 0, -0.5); // Прямо перед камерой
        this.camera.add(this.vignette);
    }

    update(deltaTime, collidableObjects) {
        if (!deltaTime) return;

        const leftStick = this.input.getLeftStick();
        const rightStick = this.input.getRightStick();

        let isMoving = false;

        // 1. Логика движения (Левый стик / WASD)
        if (Math.abs(leftStick.x) > 0.1 || Math.abs(leftStick.y) > 0.1) {
            isMoving = true;

            // Направление взгляда камеры в горизонтальной плоскости
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            forward.y = 0;
            forward.normalize();

            const right = new THREE.Vector3();
            right.crossVectors(forward, this.camera.up).normalize();

            // Вектор желаемого движения
            const moveDirection = new THREE.Vector3()
                .addScaledVector(forward, -leftStick.y)
                .addScaledVector(right, leftStick.x)
                .normalize();

            const moveStep = moveDirection.clone().multiplyScalar(this.speed * deltaTime);

            // Простая проверка коллизий (AABB / Лучи перед шагом)
            if (!this.checkCollisions(this.cameraRig.position, moveStep, collidableObjects)) {
                this.cameraRig.position.add(moveStep);
            }
        }

        // 2. Логика Snap-поворотов (Правый стик)
        if (Math.abs(rightStick.x) > 0.5) {
            if (!this.snapCooldown) {
                const direction = rightStick.x > 0 ? -1 : 1;
                this.cameraRig.rotateY(this.snapTurnAngle * direction);
                this.snapCooldown = true;
                setTimeout(() => { this.snapCooldown = false; }, 300); // Кулдаун на поворот
            }
        }

        // 3. Управление интенсивностью виньетки
        if (isMoving) {
            this.vignette.material.opacity = THREE.MathUtils.lerp(this.vignette.material.opacity, 0.7, 10 * deltaTime);
        } else {
            this.vignette.material.opacity = THREE.MathUtils.lerp(this.vignette.material.opacity, 0.0, 10 * deltaTime);
        }
    }

    checkCollisions(currentPos, step, objects) {
        if (!objects || objects.length === 0) return false;

        // Проверяем точку, куда наступает игрок
        const targetPos = currentPos.clone().add(step);
        const playerRadius = 0.4;

        for (let obj of objects) {
            if (obj.isMesh) {
                const box = new THREE.Box3().setFromObject(obj);
                // Проверяем пересечение воображаемого цилиндра игрока с Bounding Box объекта
                const closestPoint = box.clampPoint(targetPos, new THREE.Vector3());
                const distance = targetPos.distanceTo(closestPoint);
                if (distance < playerRadius) {
                    return true; // Обнаружено столкновение
                }
            }
        }
        return false;
    }
}
