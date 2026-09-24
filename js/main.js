// ============================================================
// BUSCA A SALCOTÍN (versión sin motores externos)
//
// Escena original:
//   - intro.png  : cartel "¡Busca a Salcotín!" frente a la cámara
//   - 1.png (x3) : tres Salcotín que flotan alrededor, cambian de
//                  lugar cada 5sg de forma aleatorea
//   - Al tocar uno: los tres se encogen, y aparece el premio de ese
//     Salcotín seleccionado (2.png, 3.png o 4.png) y sale confeti con
//     una mezcla de amarillo.png, celeste.png y rosa.png
//
// En computador (sin sensores) se mira alrededor arrastrando con el mouse en la pantalla.
// ============================================================

// ---------- Ajustes ----------
const CONFIG = {
  // Tamaño de cada plano: Salcotín y premios
  PLANE_WIDTH: 1.3,
  PLANE_HEIGHT: 2.3,

  // Cartel de inicio (2 x 1.4, a unos 3 m)
  INTRO_WIDTH: 2,
  INTRO_HEIGHT: 1.4,
  INTRO_DISTANCE: 3,
  INTRO_HEIGHT_OFFSET: -0.7,   // metros respecto a la cámara

  RADIUS_RANGE: [3, 5],        // distancia de los Salcotín a la cámara (m)
  HEIGHT_RANGE: [0.3, 1.5],    // altura del centro sobre el suelo (m)
  EYE_HEIGHT: 2.5,             // altura aproximada de los ojos (m)
  FRONT_EXCLUSION_DEG: 60,     // a cada lado del frente donde nunca aparecen
  MIN_SEPARATION_DEG: 35,      // separación mínima entre Salcotínes para que no se tapen
  MOVE_INTERVAL_MS: 5000,

  CAMERA_FOV: 60,
  SMOOTHING: 0.3,              // 0 a 1: más bajo = movimiento más suave
  SHOW_POINTER: false,         // true = flecha que indica dónde hay un Salcotín
}

const ASSETS = {
  intro: 'assets/intro.png',
  salcotin: 'assets/1.png',
  prizes: ['assets/2.png', 'assets/3.png', 'assets/4.png'],
  confetti: ['assets/amarillo.png', 'assets/celeste.png', 'assets/rosa.png'],
}

const randRange = (min, max) => Math.random() * (max - min) + min
const toRad = (deg) => (deg * Math.PI) / 180
const $ = (id) => document.getElementById(id)

// ---------- Estado general ----------
let renderer, scene, camera
let textures = {}
let intro
let introAngle = null   // ángulo fijo donde quedó el cartel de inicio
let salcotines = []   // { mesh, prize, angle }
let swapped = false
let moveIntervalId = null
let dragMode = false
let started = false

// ============================================================
// 1. Orientación del celular -> rotación de la cámara 3D
// ============================================================
const orientation = { alpha: null, beta: 0, gamma: 0 }
const targetQuat = new THREE.Quaternion()
const zAxis = new THREE.Vector3(0, 0, 1)
const tmpEuler = new THREE.Euler()
const tmpQuat = new THREE.Quaternion()
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
  tmpEuler.set(toRad(orientation.beta), toRad(orientation.alpha), -toRad(orientation.gamma), 'YXZ')
  targetQuat.setFromEuler(tmpEuler)
  targetQuat.multiply(toFront)
  targetQuat.multiply(tmpQuat.setFromAxisAngle(zAxis, -toRad(screenAngle())))
}

let yaw = 0
let pitch = 0
function updateTargetFromDrag() {
  tmpEuler.set(pitch, yaw, 0, 'YXZ')
  targetQuat.setFromEuler(tmpEuler)
}

// ============================================================
// 2. Permisos, cámara e imágenes
// ============================================================
async function requestMotionPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    const state = await DeviceOrientationEvent.requestPermission()
    if (state !== 'granted') throw new Error('MOTION_DENIED')
  }
  window.addEventListener('deviceorientation', onDeviceOrientation)
}

async function startCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('NO_CAMERA_API')
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  })
  const video = $('camera-feed')
  video.srcObject = stream
  await video.play()
}

function loadTexture(loader, url) {
  return new Promise((resolve, reject) => {
    loader.load(url, (tex) => {
      tex.encoding = THREE.sRGBEncoding
      tex.anisotropy = 4
      resolve(tex)
    }, undefined, () => reject(new Error('No se pudo cargar ' + url)))
  })
}

async function loadAllTextures() {
  const loader = new THREE.TextureLoader()
  const [intro, salcotin, ...rest] = await Promise.all([
    loadTexture(loader, ASSETS.intro),
    loadTexture(loader, ASSETS.salcotin),
    ...ASSETS.prizes.map((u) => loadTexture(loader, u)),
    ...ASSETS.confetti.map((u) => loadTexture(loader, u)),
  ])
  textures = {
    intro,
    salcotin,
    prizes: rest.slice(0, ASSETS.prizes.length),
    confetti: rest.slice(ASSETS.prizes.length),
  }
}

function friendlyError(error) {
  const name = error && (error.name || error.message)
  if (!window.isSecureContext) return 'La página tiene que abrirse con https:// para poder usar la cámara.'
  if (name === 'MOTION_DENIED') return 'Se negó el permiso de movimiento. Cierra esta pestaña, vuelve a abrir el link y acepta el permiso.'
  if (name === 'NO_CAMERA_API') return 'Este navegador no permite usar la cámara. Abre el link en Safari (iPhone) o Chrome (Android), no dentro de Instagram o WhatsApp.'
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Se negó el permiso de cámara. Actívalo en los ajustes del navegador para este sitio y recarga la página.'
  if (name === 'NotReadableError') return 'La cámara está siendo usada por otra app. Ciérrala y recarga la página.'
  return 'Ocurrió un error inesperado: ' + (error && error.message ? error.message : name)
}

function showError(error) {
  console.error(error)
  $('loading-screen').classList.add('hidden')
  $('start-screen').classList.add('hidden')
  $('error-message').textContent = friendlyError(error)
  $('error-screen').classList.remove('hidden')
}

// ============================================================
// 3. Escena 3D
// ============================================================
function makePlane(texture, width, height) {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  )
  scene.add(mesh)
  return mesh
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({ canvas: $('scene'), alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.setClearColor(0x000000, 0)
  renderer.outputEncoding = THREE.sRGBEncoding

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV, window.innerWidth / window.innerHeight, 0.05, 100)

  intro = makePlane(textures.intro, CONFIG.INTRO_WIDTH, CONFIG.INTRO_HEIGHT)
  intro.visible = false

  for (let i = 0; i < textures.prizes.length; i++) {
    const mesh = makePlane(textures.salcotin, CONFIG.PLANE_WIDTH, CONFIG.PLANE_HEIGHT)
    const prize = makePlane(textures.prizes[i], CONFIG.PLANE_WIDTH, CONFIG.PLANE_HEIGHT)
    mesh.visible = false
    prize.visible = false
    prize.scale.setScalar(0)
    mesh.userData.phase = Math.random() * 1000
    salcotines.push({ mesh, prize, angle: 0 })
  }

  window.addEventListener('resize', onResize)
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200))
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}

function forwardAngle() {
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion)
  return Math.atan2(f.x, f.z)
}

// que una imagen mire siempre a la persona (girando solo en vertical)
function faceCamera(mesh) {
  mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z)
}

function placeIntro() {
  const a = forwardAngle()
  introAngle = a   // lo dejamos guardado para usarlo como zona prohibida
  intro.position.set(
    Math.sin(a) * CONFIG.INTRO_DISTANCE,
    CONFIG.INTRO_HEIGHT_OFFSET,
    Math.cos(a) * CONFIG.INTRO_DISTANCE
  )
  faceCamera(intro)
  intro.visible = true
}

// ---------- Mover los Salcotín a puntos al azar alrededor ----------
function angleDiff(a, b) {
  let d = Math.abs(a - b) % (2 * Math.PI)
  return d > Math.PI ? 2 * Math.PI - d : d
}

// cuánto ángulo (en grados) ocupa, visto desde la cámara, algo de cierto ancho a cierta distancia
function angularHalfWidthDeg(width, distance) {
  return (Math.atan2(width / 2, distance) * 180) / Math.PI
}

function moveAllToRandomPoints() {
  const front = forwardAngle()
  const halfExcluded = toRad(CONFIG.FRONT_EXCLUSION_DEG)
  const allowedSpan = 2 * Math.PI - 2 * halfExcluded
  const used = []

  // reservar la zona donde está el cartel de inicio para que nadie aparezca encima
  if (introAngle !== null) {
    const introHalfWidthDeg = angularHalfWidthDeg(CONFIG.INTRO_WIDTH, CONFIG.INTRO_DISTANCE)
    const salcotinHalfWidthDeg = angularHalfWidthDeg(CONFIG.PLANE_WIDTH, CONFIG.RADIUS_RANGE[0])
    used.push({ angle: introAngle, minSepDeg: introHalfWidthDeg + salcotinHalfWidthDeg + 10 })
  }

  for (const s of salcotines) {
    let angle
    for (let tries = 0; tries < 15; tries++) {
      angle = front + halfExcluded + Math.random() * allowedSpan
      if (used.every((u) => angleDiff(u.angle, angle) > toRad(u.minSepDeg))) break
    }
    used.push({ angle, minSepDeg: CONFIG.MIN_SEPARATION_DEG })

    const radius = randRange(CONFIG.RADIUS_RANGE[0], CONFIG.RADIUS_RANGE[1])
    const y = randRange(CONFIG.HEIGHT_RANGE[0], CONFIG.HEIGHT_RANGE[1]) - CONFIG.EYE_HEIGHT
    s.mesh.position.set(Math.sin(angle) * radius, y, Math.cos(angle) * radius)
    s.prize.position.copy(s.mesh.position)
  }
}

// ---------- Animación de escala ----------
function animateScale(object3d, { from, to, duration, onComplete }) {
  const start = performance.now()
  object3d.userData.animating = true
  object3d.scale.setScalar(from)
  function step(now) {
    const t = Math.min((now - start) / duration, 1)
    const eased = 1 - (1 - t) * (1 - t) // easeOutQuad, igual que el original
    object3d.scale.setScalar(from + (to - from) * eased)
    if (t < 1) requestAnimationFrame(step)
    else {
      object3d.userData.animating = false
      if (onComplete) onComplete()
    }
  }
  requestAnimationFrame(step)
}

// ---------- Confeti con las imágenes originales ----------
function createConfettiBurst(texture, position, gravity) {
  const count = 35 // igual que "particlesPerShot" del original
  const sprites = []
  const img = texture.image
  const aspect = img.width / img.height

  for (let i = 0; i < count; i++) {
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false })
    material.rotation = Math.random() * Math.PI * 2
    const sprite = new THREE.Sprite(material)
    const size = randRange(0.06, 0.11)
    sprite.scale.set(size * aspect, size, 1)
    sprite.position.copy(position)

    // dirección al azar en todas las direcciones (spread 360) con impulso hacia arriba
    const dir = new THREE.Vector3(randRange(-1, 1), randRange(-0.3, 1), randRange(-1, 1)).normalize()
    const speed = randRange(1.2, 2.4)
    sprite.userData.v = dir.multiplyScalar(speed).add(new THREE.Vector3(0, 1.2, 0))
    sprite.userData.spin = randRange(-6, 6)
    scene.add(sprite)
    sprites.push(sprite)
  }

  const start = performance.now()
  let last = start
  const duration = 1300

  function step(now) {
    const t = (now - start) / duration
    const dt = (now - last) / 1000
    last = now
    if (t >= 1) {
      sprites.forEach((s) => { scene.remove(s); s.material.dispose() })
      return
    }
    for (const s of sprites) {
      s.userData.v.y -= gravity * 9.8 * dt
      s.position.addScaledVector(s.userData.v, dt)
      s.material.rotation += s.userData.spin * dt
      s.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4
    }
    requestAnimationFrame(step)
  }
  requestAnimationFrame(step)
}

// ---------- Atrapar a un Salcotín ----------
function onCatch(caught) {
  if (swapped) return
  swapped = true
  clearInterval(moveIntervalId)
  $('pointer').classList.add('hidden')

  // los tres Salcotín se encogen
  for (const s of salcotines) {
    animateScale(s.mesh, {
      from: s.mesh.scale.x,
      to: 0,
      duration: 200,
      onComplete: () => { s.mesh.visible = false },
    })
  }

  // aparece el premio de este Salcotín
  caught.prize.position.copy(caught.mesh.position)
  faceCamera(caught.prize)
  caught.prize.visible = true
  animateScale(caught.prize, { from: 0, to: 1, duration: 300 })

  // confeti (misma gravedad que cada emisor original)
  const pos = caught.mesh.position.clone()
  const gravities = [0.6, 0.5, 0.2]
  textures.confetti.forEach((tex, i) => createConfettiBurst(tex, pos, gravities[i] || 0.4))

  if (navigator.vibrate) navigator.vibrate(60)
}

// ============================================================
// 4. Toques y arrastre
// ============================================================
const raycaster = new THREE.Raycaster()
const tapNdc = new THREE.Vector2()
let pointerStart = null

function tryTap(clientX, clientY) {
  if (swapped) return
  tapNdc.x = (clientX / window.innerWidth) * 2 - 1
  tapNdc.y = -(clientY / window.innerHeight) * 2 + 1
  raycaster.setFromCamera(tapNdc, camera)
  const meshes = salcotines.filter((s) => s.mesh.visible).map((s) => s.mesh)
  const hits = raycaster.intersectObjects(meshes, false)
  if (hits.length > 0) {
    const caught = salcotines.find((s) => s.mesh === hits[0].object)
    onCatch(caught)
  }
}

function setupInput() {
  const canvas = $('scene')
  canvas.addEventListener('pointerdown', (e) => {
    pointerStart = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY }
  })
  canvas.addEventListener('pointermove', (e) => {
    if (!pointerStart || !dragMode) return
    yaw += (e.clientX - pointerStart.lastX) * 0.005
    pitch = Math.max(-1.3, Math.min(1.3, pitch + (e.clientY - pointerStart.lastY) * 0.005))
    pointerStart.lastX = e.clientX
    pointerStart.lastY = e.clientY
  })
  canvas.addEventListener('pointerup', (e) => {
    if (!pointerStart) return
    const moved = Math.hypot(e.clientX - pointerStart.x, e.clientY - pointerStart.y)
    pointerStart = null
    if (moved < 12) tryTap(e.clientX, e.clientY)
  })
  canvas.addEventListener('pointercancel', () => { pointerStart = null })
}

// ============================================================
// 5. Flecha opcional hacia el Salcotín más cercano (CONFIG.SHOW_POINTER)
// ============================================================
const tmpVec = new THREE.Vector3()
function updatePointer() {
  const pointer = $('pointer')
  if (!CONFIG.SHOW_POINTER || swapped) return

  let best = null
  let bestAngle = Infinity
  const front = forwardAngle()
  for (const s of salcotines) {
    if (!s.mesh.visible) continue
    const a = Math.atan2(s.mesh.position.x, s.mesh.position.z)
    const d = angleDiff(a, front)
    if (d < bestAngle) { bestAngle = d; best = s }
  }
  if (!best) return

  tmpVec.copy(best.mesh.position).applyMatrix4(camera.matrixWorldInverse)
  const ndc = best.mesh.position.clone().project(camera)
  if (tmpVec.z < 0 && Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1) {
    pointer.classList.add('hidden')
    return
  }
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
  if (dragMode) updateTargetFromDrag()
  else if (orientation.alpha !== null) updateTargetFromSensors()
  camera.quaternion.slerp(targetQuat, CONFIG.SMOOTHING)
  camera.updateMatrixWorld()

  for (const s of salcotines) {
    if (s.mesh.visible) {
      faceCamera(s.mesh)
      // "latido" como el original: 1.3x2.3 -> 1.34x2.4 cada 500 ms, ida y vuelta
      if (!s.mesh.userData.animating && !swapped) {
        const k = (1 - Math.cos(((now + s.mesh.userData.phase) / 500) * Math.PI)) / 2
        s.mesh.scale.set(1 + 0.03 * k, 1 + 0.043 * k, 1)
      }
    }
    if (s.prize.visible) faceCamera(s.prize)
  }

  updatePointer()
  renderer.render(scene, camera)
  requestAnimationFrame(loop)
}

// ============================================================
// 7. Arranque
// ============================================================
async function launchExperience() {
  if (started) return
  started = true
  $('start-screen').classList.add('hidden')
  $('loading-screen').classList.remove('hidden')

  try {
    await requestMotionPermission() // primero, mientras el toque sigue vigente en iOS
  } catch (error) {
    showError(error)
    return
  }

  try {
    await Promise.all([
      startCamera().catch((error) => {
        // en computador sin cámara se puede seguir probando sin video de fondo
        if (error && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')) {
          console.warn('Sin cámara disponible, sigo sin video de fondo.')
          return
        }
        throw error
      }),
      loadAllTextures(),
    ])
  } catch (error) {
    showError(error)
    return
  }

  setupScene()
  setupInput()
  requestAnimationFrame(loop)

  // esperar a que los sensores entreguen datos antes de ubicar todo
  setTimeout(() => {
    if (orientation.alpha === null) dragMode = true
    // saltar la suavización para que la cámara parta en la orientación real
    if (dragMode) updateTargetFromDrag()
    else updateTargetFromSensors()
    camera.quaternion.copy(targetQuat)
    camera.updateMatrixWorld()

    placeIntro()
    moveAllToRandomPoints()
    salcotines.forEach((s) => { s.mesh.visible = true })
    moveIntervalId = setInterval(moveAllToRandomPoints, CONFIG.MOVE_INTERVAL_MS)
    $('loading-screen').classList.add('hidden')
  }, 1200)
}

$('start-button').addEventListener('click', launchExperience)
