# AR Swap

Experiencia AR con seguimiento de mundo (SLAM), hecha con el motor auto-alojado
de 8th Wall + three.js, para publicarse en GitHub Pages.

## 1. Descargar el motor de 8th Wall

1. Descarga `xr-standalone.zip` desde: https://8th.io/xrjs
2. Descomprímelo **dentro de la carpeta `xr8/`** de este proyecto.
3. Confirma que quede un archivo `xr8/xr.js` (o similar). Si el nombre es distinto,
   ajusta la ruta en el `<script>` de `index.html`.

Este motor es gratuito y no requiere `appKey`. No sube nada a la nube de 8th Wall:
corre completo en el navegador de quien escanea el QR.

## 2. Probarlo en tu computador

Como el navegador exige HTTPS para usar la cámara, no basta con abrir el
`index.html` directamente. Dos opciones:

- **Recomendado:** sube el proyecto a GitHub (paso 3) y pruébalo ahí directamente,
  GitHub Pages ya sirve todo con HTTPS.
- Local con HTTPS: usa una herramienta como `ngrok` o `local-ssl-proxy` apuntando
  a un servidor estático (`npx http-server` sirve el contenido, pero sin HTTPS
  no vas a poder activar la cámara en el celular).

## 3. Crear el repositorio y publicarlo

```bash
cd ar-swap-project
git init
git add .
git commit -m "Primera versión de AR swap"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/TU-REPO.git
git push -u origin main
```

Luego, en GitHub:
1. Ve a **Settings → Pages**.
2. En "Build and deployment", elige **Deploy from a branch**.
3. Selecciona la rama `main` y la carpeta `/ (root)`.
4. Guarda. En un par de minutos tu sitio queda en:
   `https://TU-USUARIO.github.io/TU-REPO/`

Ese link es el que va dentro del QR.

## 4. Qué hace el código (js/main.js)

- Un objeto (`idle`, esfera dorada) aparece flotando alrededor de la persona,
  a 1.5–3 metros de distancia, nunca en los 60° justo frente a la cámara.
- Cada 10 segundos cambia de posición.
- Al tocarlo: se encoge, aparece otro objeto (`target`, nudo azul) en su lugar,
  y salen tres ráfagas de confeti (amarillo, celeste, rosa).

## 5. Personalizarlo

- **Reemplazar las formas por tus modelos 3D:** carga un `.glb`/`.gltf` con
  `THREE.GLTFLoader` en vez de `THREE.Mesh` con geometría básica. Puedo
  ayudarte con ese código cuando tengas los modelos listos.
- **Más de un objeto tipo swap:** duplica el bloque desde `moveGroupToRandomPoint`
  hasta `onSwap`, dándole otro nombre a las variables (como tus
  `click-swap2.ts` / `click-swap3.ts`).
- **Ajustar distancia/altura:** cambia `RADIUS_RANGE` y `HEIGHT_RANGE` al
  inicio de `js/main.js`.
