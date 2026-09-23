# ¡Busca a Salcotín!

Experiencia de realidad aumentada en el navegador, recreada desde el proyecto
original de 8th Wall Studio, sin motores ni servicios externos. Todo (incluido
three.js) vive en este repositorio y se publica con GitHub Pages.

## Qué hace

- Muestra el cartel `intro.png` frente a la persona.
- Tres Salcotín (`1.png`) flotan alrededor, laten y cambian de lugar cada 10 s,
  nunca justo enfrente.
- Al tocar uno, los tres se encogen, aparece su premio (`2.png`, `3.png` o `4.png`)
  y sale confeti con `amarillo.png`, `celeste.png` y `rosa.png`.

## Cómo funciona

Cámara con `getUserMedia` y giro con `DeviceOrientation` (rastreo de rotación:
las imágenes quedan fijas al girar, pero no cambian de distancia al caminar).
Funciona en Safari (iPhone) y Chrome (Android). En computador se prueba
arrastrando con el mouse.

## Estructura

```
index.html
css/style.css
js/main.js
lib/three.min.js   (three.js r128, licencia MIT)
assets/            (imágenes del proyecto, optimizadas para celular)
.nojekyll
```

## Ajustes

Todo en el bloque `CONFIG` al inicio de `js/main.js`: tamaño de las imágenes,
distancia, altura, intervalo de movimiento, ángulo excluido y la flecha
opcional (`SHOW_POINTER`).
