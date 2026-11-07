# Worker de renderizado independiente

- Las rutas de subida, reintento y carpeta vigilada ahora solo encolan trabajos en SQLite; ya no crean hilos de renderizado en el servidor HTTP.
- Añadido `worker.py`, proceso independiente que reclama trabajos mediante transacciones SQLite, renueva concesiones y finaliza únicamente si conserva la propiedad.
- El servidor inicia y supervisa el worker, reiniciándolo si el proceso termina. Las concesiones expiradas se recuperan al volver a arrancar el worker.
- Los endpoints de historial y estado sincronizan los cambios escritos por el proceso worker. El progreso se persiste periódicamente para que el navegador vea actualizaciones entre procesos.
- La carpeta vigilada y el reintento reutilizan la misma cola duradera.
- Prueba real E2E con el MP4 canónico de La Resistencia: worker independiente reclamó el trabajo, ejecutó FFmpeg con transcripción y rango temporizado, guardó `completed` y produjo un MP4 H.264/AAC 1080x1920 de 24 segundos.
