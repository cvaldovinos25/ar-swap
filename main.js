// ============================================================
// AR SWAP - lógica principal
// Replica la mecánica de "click-swap.ts": un objeto flota
// alrededor de la cámara, cambia de lugar cada 10s (nunca justo
// enfrente), y al tocarlo se encoge, aparece otro en su lugar
// y sale confeti de 3 colores.
// ============================================================

const RADIUS_RANGE = [1.5, 3]
const HEIGHT_RANGE = [0.3, 1.5]
const FRONT_EXCLUSION_DEG = 60
const MOVE_INTERVAL_MS = 10000

const randRange = (min, max) => Math.random() * (max - min) + min
const toRad = (deg) => (deg * Math.PI) / 180

// ---- pequeño helper de animación de escala (reemplaza ecs.ScaleAnimation) ----
function animateScale(object3d, { from, to, duration, onComplete }) {
  const start = performance.now()
  object3d.scale.set(from, from, from)

  function step(now) {
    const t = Math.min((now - start) / duration, 1)
    // easeOutQuad, similar a la curva usada en el proyecto original
    const eased = 1 - (1 - t) * (1 - t)
    const scale = from + (to - from) * eased
    object3d.scale.set(scale, scale, scale)

    if (t < 1) {
      requestAnimationFrame(step)
    } else if (onComplete) {
      onComplete()
    }
  }
  requestAnimationFrame(step)
}

// ---- confeti simple con three.js Points ----
function createConfettiBurst(scene, color, position) {
  const count = 60
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const velocities = []

  for (let i = 0; i < count; i++) {
    positions[i * 3] = position.x
    positions[i * 3 + 1] = position.y
    positions[i * 3 + 2] = position.z

    velocities.push({
      x: randRange(-1, 1),
      y: randRange(1.5, 3),
      z: randRange(-1, 1),
    })
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ color, size: 0.06 })
  const points = new THREE.Points(geometry, material)
  scene.add(points)

  const start = performance.now()
  const duration = 1200

  function step(now) {
    const t = (now - start) / duration
    if (t >= 1) {
      scene.remove(points)
      geometry.dispose()
      material.dispose()
      return
    }

    const posAttr = geometry.attributes.position
    for (let i = 0; i < count; i++) {
      const v = velocities[i]
      posAttr.array[i * 3] = position.x + v.x * t
      posAttr.array[i * 3 + 1] = position.y + v.y * t - 2 * t * t // gravedad
      posAttr.array[i * 3 + 2] = position.z + v.z * t
    }
    posAttr.needsUpdate = true
    material.opacity = 1 - t
    material.transparent = true

    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// ---- módulo de cámara custom con nuestra lógica de escena ----
const appPipelineModule = () => ({
  name: 'ar-swap-app',

  onStart: ({ canvas }) => {
    const { scene, camera, renderer } = XR8.Threejs.xrScene()

    // luz básica para que los materiales no se vean planos
    scene.add(new THREE.HemisphereLight('white', 'darkslategrey', 1))
    const light = new THREE.DirectionalLight('white', 0.8)
    light.position.set(1, 2, 1)
    scene.add(light)

    // --- objeto "idle": el que ves flotando y late ---
    const idle = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.15, 0),
      new THREE.MeshStandardMaterial({ color: 0xffd54f })
    )
    idle.position.set(0, 1, -2)
    scene.add(idle)

    // --- objeto "target": el que aparece al tocar (reemplázalo por tu modelo) ---
    const target = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.15, 0.05, 100, 16),
      new THREE.MeshStandardMaterial({ color: 0x4fc3f7 })
    )
    target.scale.set(0, 0, 0)
    target.visible = false
    scene.add(target)

    let moveIntervalId
    let swapped = false

    const moveGroupToRandomPoint = () => {
      let forwardAngle = 0
      const camPos = camera.position

      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
      forwardAngle = Math.atan2(forward.x, forward.z)

      const halfExcluded = toRad(FRONT_EXCLUSION_DEG)
      const allowedSpan = 2 * Math.PI - 2 * halfExcluded
      const angle = forwardAngle + halfExcluded + Math.random() * allowedSpan

      const radius = randRange(RADIUS_RANGE[0], RADIUS_RANGE[1])
      const x = camPos.x + Math.sin(angle) * radius
      const z = camPos.z + Math.cos(angle) * radius
      const y = camPos.y + randRange(HEIGHT_RANGE[0], HEIGHT_RANGE[1]) - 1

      idle.position.set(x, y, z)
      if (!swapped) target.position.set(x, y, z)
    }

    moveGroupToRandomPoint()
    moveIntervalId = setInterval(moveGroupToRandomPoint, MOVE_INTERVAL_MS)

    const onSwap = () => {
      if (swapped) return
      swapped = true
      clearInterval(moveIntervalId)

      animateScale(idle, {
        from: idle.scale.x,
        to: 0,
        duration: 200,
        onComplete: () => { idle.visible = false },
      })

      target.visible = true
      target.position.copy(idle.position)
      animateScale(target, { from: 0, to: 1, duration: 300 })

      createConfettiBurst(scene, 0xffeb3b, target.position) // amarillo
      createConfettiBurst(scene, 0x4dd0e1, target.position) // celeste
      createConfettiBurst(scene, 0xf06292, target.position) // rosa
    }

    // raycasting desde el toque de pantalla hacia el objeto "idle"
    const raycaster = new THREE.Raycaster()
    const tapPos = new THREE.Vector2()

    window.addEventListener('touchstart', (e) => {
      const touch = e.touches[0]
      tapPos.x = (touch.clientX / window.innerWidth) * 2 - 1
      tapPos.y = -(touch.clientY / window.innerHeight) * 2 + 1

      raycaster.setFromCamera(tapPos, camera)
      const hits = raycaster.intersectObject(idle)
      if (hits.length > 0) onSwap()
    })

    // fallback para pruebas en desktop con mouse
    window.addEventListener('click', (e) => {
      tapPos.x = (e.clientX / window.innerWidth) * 2 - 1
      tapPos.y = -(e.clientY / window.innerHeight) * 2 + 1
      raycaster.setFromCamera(tapPos, camera)
      const hits = raycaster.intersectObject(idle)
      if (hits.length > 0) onSwap()
    })
  },

  onUpdate: () => {
    // pequeño "latido" del objeto idle, igual que la animación en loop del original
  },
})

// ---- arranque del motor ----
const onxrloaded = () => {
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),
    XR8.Threejs.pipelineModule(),
    XR8.XrController.pipelineModule(),
    appPipelineModule(),
    {
      name: 'loading-handler',
      onStart: () => {
        document.getElementById('loading-screen').classList.add('hidden')
      },
      onException: (error) => {
        console.error(error)
        document.getElementById('permission-error').classList.remove('hidden')
      },
    },
  ])

  XR8.run({ canvas: document.getElementById('camerafeed') })
}

window.XR8 ? onxrloaded() : window.addEventListener('xrloaded', onxrloaded)
