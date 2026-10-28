# Estado Documental Procedimientos y Protocolos - ChinaLed

Dashboard QA/QC del PFV Cerro Sombrero (contrato 42PS25): avance documental de procedimientos y protocolos.

**Dashboard:** https://rarubilar.github.io/Estado-Documental-Procedimientos-y-Protocolos-ChinaLed/

## Cómo se actualiza

1. Las dos matrices Excel están en Google Drive, compartidas como "Cualquier persona con el enlace" (lector).
   Sus IDs están en `dashboard/config.json`.
2. Cada 10 minutos, GitHub Actions (`.github/workflows/actualizar.yml`) descarga ambos archivos y compara su huella con `estado.json`.
3. Si cambiaron, `dashboard/export-static.mjs` genera la página con los datos nuevos y la fecha del día (hora de Magallanes),
   y la publica en GitHub Pages. Si no cambiaron, no hace nada.

Los Excel no se guardan en este repositorio: solo se publica la página procesada.
Para forzar una actualización: pestaña **Actions** → "Actualizar dashboard" → **Run workflow**.
