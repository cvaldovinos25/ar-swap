// ============================================================
// AR SWAP (versión sin motores externos)
//
// Usa solo lo que trae el navegador:
//   - getUserMedia        -> imagen de la cámara trasera de fondo
//   - DeviceOrientation   -> el giro del celular mueve la cámara 3D
//   - three.js (local)    -> dibuja los objetos y el confeti
//
// Mecánica: un objeto flota alrededor de la persona, cambia de
// lugar cada 10 s (nunca justo enfrente) y al tocarlo se encoge,
// aparece otro objeto en su lugar y sale confeti de 3 colores.
//
// En computador (sin sensores) se puede mirar alrededor
// arrastrando con el mouse, para hacer pruebas.
// ============================================================

// ---------- Ajustes ----------
const CONFIG = {
  RADIUS_RANGE: [1.5, 3],       // distancia a la persona, en metros
  HEIGHT_RANGE: [-0.7, 0.5],    // altura respecto a los ojos, en metros
  FRONT_EXCLUSION_DEG: 60,      // ángulo total frente a la cámara donde nunca aparece
  MOVE_INTERVAL_MS: 10000,      // cada cuánto cambia de lugar
  CAMERA_FOV: 60,               // campo de visión vertical aproximado de un celular
  SMOOTHING: 0.3,               // 0 a 1: más bajo = movimiento más suave
}

const randRange = (min, max) => Math.random() * (max - min) + min
const toRad = (deg) => (deg * Math.PI) / 180
const $ = (id) => document.getElementById(id)

// ---------- Estado general ----------
let renderer, scene, camera
let idle, idleHitArea, target
let swapped = false
let moveIntervalId = null
let dragMode = false
let started = false

// ============================================================
// 1. Orientación del celular -> rotación de la cámara 3D
// (mismo cálculo que usaba DeviceOrientationControls de three.js)
// ============================================================
const orientation = { alpha: null, beta: 0, gamma: 0 }
const targetQuat = new THREE.Quaternion()
const zAxis = new THREE.Vector3(0, 0, 1)
const tmpEuler = new THREE.Euler()
const tmpQuat = new THREE.Quaternion()
// rota -90° en X: pasa de "celular acostado mirando al cielo" a "mirando al frente"
const toFront = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5))

function onDeviceOrientation(event) {
  if (event.alpha === null) return
  orientation.alpha = event.alpha
  orientation.beta = event.beta
  orientation.gamma = event.gamma
}

function screenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle
  }
  return window.orientation || 0
}

function updateTargetFromSensors() {
  const alpha = toRad(orientation.alpha)
  const beta = toRad(orientation.beta)
  const gamma = toRad(orientation.gamma)
  const orient = toRad(screenAngle())

  tmpEuler.set(beta, alpha, -gamma, 'YXZ')
  targetQuat.setFromEuler(tmpEuler)
  targetQuat.multiply(toFront)
  targetQuat.multiply(tmpQuat.setFromAxisAngle(zAxis, -orient))
}

// ---------- Modo arrastre (computador) ----------
let yaw = 0
let pitch = 0
function updateTargetFromDrag() {
  tmpEuler.set(pitch, yaw, 0, 'YXZ')
  targetQuat.setFromEuler(tmpEuler)
}

// ============================================================
// 2. Permisos y cámara
// ============================================================
async function requestMotionPermission() {
  // iPhone (iOS 13+) exige pedir permiso a partir de un toque
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    const state = await DeviceOrientationEvent.requestPermission()
    if (state !== 'granted') {
      throw new Error('MOTION_DENIED')
    }
  }
  window.addEventListener('deviceorientation', onDeviceOrientation)
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('NO_CAMERA_API')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  })
  const video = $('camera-feed')
  video.srcObject = stream
  await video.play()
}

function friendlyError(error) {
  const name = error && (error.name || error.message)
  if (!window.isSecureContext) {
    return 'La página tiene que abrirse con https:// para poder usar la cámara.'
  }
  if (name === 'MOTION_DENIED') {
    return 'Se negó el permiso de movimiento. Cierra esta pestaña, vuelve a abrir el link y acepta el permiso.'
  }
  if (name === 'NO_CAMERA_API') {
    return 'Este navegador no permite usar la cámara. Abre el link en Safari (iPhone) o Chrome (Android), no dentro de Instagram o WhatsApp.'
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Se negó el permiso de cámara. Actívalo en los ajustes del navegador para este sitio y recarga la página.'
  }
  if (name === 'NotReadableError') {
    return 'La cámara está siendo usada por otra app. Ciérrala y recarga la página.'
  }
  return 'Ocurrió un error inesperado: ' + (error && error.message ? error.message : name)
}

function showError(error) {
  console.error(error)
  $('loading-screen').classList.add('hidden')
  $('start-screen').classList.add('hidden')
  $('error-message').textContent = friendlyError(error)
  $('error-screen').classList.remove('hidden')
}

function showHint(text, ms) {
  const hint = $('hint')
  hint.textContent = text
  hint.classList.remove('hidden')
  clearTimeout(showHint.timer)
  if (ms) showHint.timer = setTimeout(() => hint.classList.add('hidden'), ms)
}

// ============================================================
// 3. Escena 3D
// ============================================================
function setupScene() {
  renderer = new THREE.WebGLRenderer({ canvas: $('scene'), alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor(0x000000, 0)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV, window.innerWidth / window.innerHeight, 0.05, 100)
  camera.position.set(0, 0, 0)

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2f4f4f, 1))
  const light = new THREE.DirectionalLight(0xffffff, 0.8)
  light.position.set(1, 2, 1)
  scene.add(light)

  // objeto "idle": el que flota y hay que encontrar
  idle = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.15, 0),
    new THREE.MeshStandardMaterial({ color: 0xffd54f, flatShading: true })
  )
  scene.add(idle)

  // zona de toque más grande e invisible, para que sea fácil acertarle con el dedo
  idleHitArea = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
  )
  idle.add(idleHitArea)

  // objeto "target": el que aparece al tocar (reemplázalo por tu modelo)
  target = new THREE.Mesh(
    new THREE.TorusKnotGeometry(0.15, 0.05, 100, 16),
    new THREE.MeshStandardMaterial({ color: 0x4fc3f7 })
  )
  target.scale.set(0, 0, 0)
  target.visible = false
  scene.add(target)

  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200))
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

// ---------- Mover el objeto a un punto al azar alrededor ----------
function moveToRandomPoint() {
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  const forwardAngle = Math.atan2(forward.x, forward.z)

  const halfExcluded = toRad(CONFIG.FRONT_EXCLUSION_DEG / 2)
  const allowedSpan = 2 * Math.PI - 2 * halfExcluded
  const angle = forwardAngle + halfExcluded + Math.random() * allowedSpan

  const radius = randRange(CONFIG.RADIUS_RANGE[0], CONFIG.RADIUS_RANGE[1])
  const x = Math.sin(angle) * radius
  const z = Math.cos(angle) * radius
  const y = randRange(CONFIG.HEIGHT_RANGE[0], CONFIG.HEIGHT_RANGE[1])

  idle.position.set(x, y, z)
}

// ---------- Animación de escala ----------
function animateScale(object3d, { from, to, duration, onComplete }) {
  const start = performance.now()
  object3d.userData.animating = true
  object3d.scale.setScalar(from)

  function step(now) {
    const t = Math.min((now - start) / duration, 1)
    const eased = 1 - (1 - t) * (1 - t) // easeOutQuad
    object3d.scale.setScalar(from + (to - from) * eased)
    if (t < 1) {
      requestAnimationFrame(step)
    } else {
      object3d.userData.animating = false
      if (onComplete) onComplete()
    }
  }
  requestAnimationFrame(step)
}

// ---------- Confeti ----------
function createConfettiBurst(color, position) {
  const count = 60
  const geometry = new THREE.BufferGeometry()
  const positions = new Float32Array(count * 3)
  const velocities = []

  for (let i = 0; i < count; i++) {
    positions[i * 3] = position.x
    positions[i * 3 + 1] = position.y
    positions[i * 3 + 2] = position.z
    velocities.push({ x: randRange(-1, 1), y: randRange(1.5, 3), z: randRange(-1, 1) })
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const material = new THREE.PointsMaterial({ color, size: 0.06, transparent: true })
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
    const arr = geometry.attributes.position.array
    for (let i = 0; i < count; i++) {
      const v = velocities[i]
      arr[i * 3] = position.x + v.x * t
      arr[i * 3 + 1] = position.y + v.y * t - 2 * t * t // gravedad
      arr[i * 3 + 2] = position.z + v.z * t
    }
    geometry.attributes.position.needsUpdate = true
    material.opacity = 1 - t
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// ---------- Swap ----------
function onSwap() {
  if (swapped) return
  swapped = true
  clearInterval(moveIntervalId)
  $('pointer').classList.add('hidden')
  $('hint').classList.add('hidden')

  animateScale(idle, {
    from: idle.scale.x,
    to: 0,
    duration: 200,
    onComplete: () => { idle.visible = false },
  })

  target.position.copy(idle.position)
  target.visible = true
  animateScale(target, { from: 0, to: 1, duration: 300 })

  const pos = idle.position.clone()
  createConfettiBurst(0xffeb3b, pos) // amarillo
  createConfettiBurst(0x4dd0e1, pos) // celeste
  createConfettiBurst(0xf06292, pos) // rosa

  if (navigator.vibrate) navigator.vibrate(60)
  setTimeout(() => $('restart-button').classList.remove('hidden'), 1200)
}

function restart() {
  $('restart-button').classList.add('hidden')
  swapped = false
  target.visible = false
  target.scale.setScalar(0)
  idle.visible = true
  idle.scale.setScalar(1)
  moveToRandomPoint()
  clearInterval(moveIntervalId)
  moveIntervalId = setInterval(moveToRandomPoint, CONFIG.MOVE_INTERVAL_MS)
  showHint('Gira para buscar el objeto', 3000)
}

// ============================================================
// 4. Toques y arrastre
// ============================================================
const raycaster = new THREE.Raycaster()
const tapNdc = new THREE.Vector2()
let pointerStart = null

function tryTap(clientX, clientY) {
  if (swapped || !idle.visible) return
  tapNdc.x = (clientX / window.innerWidth) * 2 - 1
  tapNdc.y = -(clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(tapNdc, camera)
  if (raycaster.intersectObject(idle, true).length > 0) onSwap()
}

function setupInput() {
  const canvas = $('scene')

  canvas.addEventListener('pointerdown', (e) => {
    pointerStart = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY }
  })

  canvas.addEventListener('pointermove', (e) => {
    if (!pointerStart || !dragMode) return
    const dx = e.clientX - pointerStart.lastX
    const dy = e.clientY - pointerStart.lastY
    pointerStart.lastX = e.clientX
    pointerStart.lastY = e.clientY
    yaw += dx * 0.005
    pitch = Math.max(-1.3, Math.min(1.3, pitch + dy * 0.005))
  })

  canvas.addEventListener('pointerup', (e) => {
    if (!pointerStart) return
    const moved = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y)
    pointerStart = null
    if (moved < 12) tryTap(e.clientX, e.clientY)
  })

  canvas.addEventListener('pointercancel', () => { pointerStart = null })
  $('restart-button').addEventListener('click', restart)
}

// ============================================================
// 5. Flecha indicadora cuando el objeto está fuera de pantalla
// ============================================================
const tmpVec = new THREE.Vector3()
function updatePointer() {
  const pointer = $('pointer')
  if (swapped || !idle.visible) return

  // posición del objeto vista desde la cámara
  tmpVec.copy(idle.position).applyMatrix4(camera.matrixWorldInverse)
  const inFront = tmpVec.z < 0
  const ndc = idle.position.clone().project(camera)
  const onScreen = inFront && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.9

  if (onScreen) {
    pointer.classList.add('hidden')
    return
  }

  // dirección en pantalla hacia el objeto (y de pantalla crece hacia abajo)
  let dx = tmpVec.x
  let dy = -tmpVec.y
  if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dx = 1
  const angle = Math.atan2(dy, dx)

  const w = window.innerWidth
  const h = window.innerHeight
  const x = w / 2 + Math.cos(angle) * (w / 2 - 44) - 22
  const y = h / 2 + Math.sin(angle) * (h / 2 - 90) - 22

  pointer.style.transform = `translate(${x}px, ${y}px) rotate(${angle}rad)`
  pointer.classList.remove('hidden')
}

// ============================================================
// 6. Bucle de dibujo
// ============================================================
function loop(now) {
  if (dragMode) {
    updateTargetFromDrag()
  } else if (orientation.alpha !== null) {
    updateTargetFromSensors()
  }
  camera.quaternion.slerp(targetQuat, CONFIG.SMOOTHING)
  camera.updateMatrixWorld()

  const t = now / 1000
  if (idle.visible && !swapped && !idle.userData.animating) {
    idle.scale.setScalar(1 + 0.08 * Math.sin(t * 4)) // "latido"
    idle.rotation.y += 0.01
  }
  if (target.visible) target.rotation.y += 0.015

  updatePointer()
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}

// ============================================================
// 7. Arranque (al tocar "Activar cámara")
// ============================================================
async function launchExperience() {
  if (started) return
  started = true
  $('start-screen').classList.add('hidden')
  $('loading-screen').classList.remove('hidden')

  try {
    await requestMotionPermission() // primero, mientras el toque sigue "vigente" en iOS
  } catch (error) {
    showError(error)
    return
  }

  try {
    await startCamera()
  } catch (error) {
    const name = error && error.name
    // en computador sin cámara se puede seguir probando sin fondo de video
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      console.warn('Sin cámara disponible, sigo sin fondo de video.')
    } else {
      showError(error)
      return
    }
  }

  setupScene()
  setupInput()
  $('loading-screen').classList.add('hidden')

  // si en 1.5 s no llegan datos de los sensores, activar modo arrastre (computador)
  setTimeout(() => {
    if (orientation.alpha === null) {
      dragMode = true
      showHint('Arrastra con el mouse para mirar alrededor', 5000)
    } else {
      showHint('Gira para buscar el objeto', 4000)
    }
    // ubicar el objeto una vez que la cámara ya tiene su orientación real
    moveToRandomPoint()
    moveIntervalId = setInterval(moveToRandomPoint, CONFIG.MOVE_INTERVAL_MS)
    idle.visible = true
  }, 1500)

  idle.visible = false
  requestAnimationFrame(loop)
}

$('start-button').addEventListener('click', launchExperience)
