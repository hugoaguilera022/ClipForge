# v1.72.0 — Modelo MLX optimizado como predeterminado

- En macOS Apple Silicon, el lanzador selecciona `large-v3-turbo` si no hay una preferencia explícita `CLIPFORGE_MLX_MODEL`.
- El usuario puede sobrescribir el modelo mediante esa variable de entorno.
- La CLI admite explícitamente `large-v3-turbo`.
- Se amplían las pruebas del adaptador para verificar el modelo resuelto y el valor predeterminado del lanzador.
- No se cambia el modelo predeterminado en Windows/Linux.
