// Navegadores sin @layer (Chrome < 99, p. ej. Android 8 sin actualizar) ignoran todo el CSS de Tailwind 4;
// este plugin convierte las capas en especificidad equivalente.
import cascadeLayers from '@csstools/postcss-cascade-layers';

export default { plugins: [cascadeLayers()] };
