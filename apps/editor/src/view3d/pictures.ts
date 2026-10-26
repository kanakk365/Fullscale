// Pictures in the home's folder (cut from photos, or the person's own), as textures for
// materials that show one. Each file is fetched once; its texture is handed out at once and
// fills in when the picture arrives.
import * as THREE from 'three';
import { authHeaders } from '../app/token.ts';

const textures = new Map<string, THREE.Texture>();

export function picture(file: string): THREE.Texture {
  let texture = textures.get(file);
  if (!texture) {
    const t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace;
    textures.set(file, t);
    texture = t;
    const url = `/files/home/${file.split('/').map(encodeURIComponent).join('/')}`;
    void fetch(url, { headers: authHeaders() })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      // Bitmaps can't be flipped on upload, so flip them here, as textures expect.
      .then((blob) => createImageBitmap(blob, { imageOrientation: 'flipY' }))
      .then(
        (bitmap) => {
          t.image = bitmap;
          t.flipY = false;
          t.needsUpdate = true;
        },
        () => undefined,
      );
  }
  return texture;
}
