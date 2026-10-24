# Your own 3D models

Put `.glb` or `.gltf` files here (subfolders are fine, e.g. `ikea/sofa.glb`). Everything in this folder except this note is ignored by git, so your files stay on your computer.

**Use models only as their owner allows.** Many shop models, including IKEA's, may be downloaded for personal, non-commercial use only and must not be shared. That is why this project never includes them, never commits them and never puts them into exports.

**Getting the size right.** Shop models often have odd units or scale, so we don't trust their size. When you add one, type the real width, height and depth from the product page. We scale the model to fit, store `maker` as the source of the size, and warn you if the model's shape doesn't match those numbers (usually a typo, or the wrong model).

If a file is missing, the item is drawn with its plain catalogue shape at the same size, so measurements never change.
