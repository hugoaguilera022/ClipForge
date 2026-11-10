# Requisito obligatorio: cuatro momentos importantes

ClipForge debe generar **exactamente cuatro clips por vídeo**. El objetivo no es imitar Opus Clip ni maximizar el número de cortes.

## Criterio de selección
1. Elegir los cuatro acontecimientos más importantes del vídeo completo.
2. Importancia narrativa demostrable: revelación, decisión, conflicto, giro, resultado, cambio de situación o reacción decisiva.
3. Cada clip debe conservar el contexto mínimo, el desarrollo y el desenlace que permitan entender el acontecimiento sin ver el vídeo entero.
4. Los cuatro clips deben ser distintos y no solaparse.
5. La importancia prima sobre la variedad artificial, el volumen, las risas, los cambios de plano y las frases llamativas aisladas.
6. Si el material no permite cuatro cortes válidos, ClipForge debe informar del problema; nunca inventar ni presentar relleno como momento importante.

## Coste y validación
- Usar el análisis local gratuito siempre que sea posible.
- Para 96 candidatos, comparar en cuatro lotes cronológicos de 24, conservar cuatro opciones por lote y hacer una votación global y una auditoría final: objetivo de seis llamadas de modelo para vídeos con 96 candidatos, no catorce.
- No llamar a varios proveedores para evaluar el mismo lote si el primero ha respondido correctamente.
- Validar timestamps reales, contexto suficiente, desenlace dentro del corte, ausencia de solapamiento y cuatro acontecimientos distintos.
- No declarar el requisito cumplido hasta revisar una generación real.
