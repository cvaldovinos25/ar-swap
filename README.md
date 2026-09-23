# AR Swap

Experiencia de realidad aumentada para el navegador, sin motores ni servicios externos.
Todo el código (incluido three.js) vive en este repositorio y se publica con GitHub Pages.

## Cómo funciona

- **Cámara:** `getUserMedia` muestra la cámara trasera de fondo.
- **Movimiento:** `DeviceOrientation` hace que la escena 3D gire junto con el celular
  (rastreo de rotación, 3DOF: el objeto queda fijo al girar, pero no cambia de
  distancia si la persona camina).
- **3D:** three.js r128, alojado en `lib/three.min.js` (licencia MIT).

Funciona en Safari (iPhone) y Chrome (Android). En computador se puede probar
arrastrando con el mouse para mirar alrededor.

## Estructura

```
index.html
css/style.css
js/main.js
lib/three.min.js
.nojekyll
```

## Publicar

Settings → Pages → Deploy from a branch → rama `main`, carpeta `/ (root)`.
El sitio queda en `https://cvaldovinos25.github.io/ar-swap/`

## Personalizar (js/main.js)

- Distancia, altura, intervalo y ángulo excluido: objeto `CONFIG` al inicio del archivo.
- Suavidad del movimiento: `CONFIG.SMOOTHING` (más bajo = más suave, más alto = más rápido).
- Formas: `idle` (esfera dorada) y `target` (nudo azul) en `setupScene()`. Se pueden
  reemplazar por modelos `.glb` usando `GLTFLoader` (también alojado localmente).
