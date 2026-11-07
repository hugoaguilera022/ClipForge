# Matriz de publicación oficial (revisión 7 nov 2026)

| Red | Integración | Gratuito garantizado | Estado del prototipo |
|---|---|---|---|
| YouTube Shorts | YouTube Data API v3 `videos.insert` + OAuth | Cuota estándar sin tarifa por llamada; límites y revisión de Google | Diseñado, no conectado |
| Instagram Reels | Instagram Graph API / Content Publishing | Sin coste de API asumido; cuenta profesional, permisos y media URL pública | Diseñado, no conectado |
| Facebook Reels | Meta Graph API | Sin coste de API asumido; Page access y permisos | Diseñado, no conectado |
| TikTok | Content Posting API Direct Post | API sin tarifa por publicación documentada aquí, pero aprobación/auditoría obligatoria | Diseñado, no conectado |
| X | X API | No se puede garantizar gratuito | Fuera del MVP gratuito |

Fuentes oficiales:
- YouTube API overview: https://developers.google.com/youtube/data/getting-started
- YouTube videos.insert: https://developers.google.com/youtube/v3/docs/videos/insert
- TikTok Direct Post: https://developers.tiktok.com/docs/en/content-posting-api-reference-direct-post
- TikTok Get Started: https://developers.tiktok.com/docs/en/content-posting-api-get-started
- TikTok sharing guidelines: https://developers.tiktok.com/docs/en/content-sharing-guidelines
- Meta Instagram content publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing/

No se automatizará el acceso con contraseñas, cookies ni navegador. Cada publicación debe contar con aprobación del titular y respetar música, derechos y políticas de cada plataforma.
\n\n## v1.4 — correcciones críticas\n- Cada trabajo guarda sus resultados en una carpeta exclusiva por ID; evita colisiones entre vídeos con el mismo nombre y corrige las rutas de vista previa/descarga.\n- Si el motor termina sin la carpeta esperada o falla, el trabajo queda marcado como fallido y se eliminan salidas parciales.\n- Límite de carga HTTP fijado en 512 MB para reducir el riesgo de agotar la memoria: el parser multipart de la versión actual mantiene temporalmente copias del cuerpo en RAM.\n\n- La interfaz refleja la disponibilidad del reconocimiento local de macOS y bloquea subidas superiores a 512 MB antes de enviarlas.\n\n\n## v1.4 — validación previa del vídeo\n- Antes de crear un trabajo, FFprobe comprueba que el archivo sea legible, tenga imagen y sonido, duración válida y resolución mínima. Los archivos corruptos o sin audio se rechazan inmediatamente con un error claro, en lugar de fallar después de iniciar el render.\n